// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Voice
// ========================

/// <summary>
/// Floo-Call voice: records the microphone, encodes it as Opus and sends it to the server, and plays the other owl's voice.
/// It runs only while a call is answered; App.js starts and stops it as the call changes.
///
/// <para>
/// Sending: microphone -> AudioWorklet (VoiceCapture.js, 20 ms frames) -> WebCodecs AudioEncoder (Opus) -> three packets per message
/// ("callId|sequence|base64"), every 60 ms -> client script -> server -> the other owl's page.
/// Receiving: message -> WebCodecs AudioDecoder -> a short jitter buffer of scheduled Web Audio buffers -> speakers.
/// </para>
///
/// <para>
/// NOTE: Voices go through the server, never straight between players, so nobody learns another player's IP address.
/// The cost is one network event per talking player every 60 ms, which is why silence is not sent at all:
/// after half a second below the silence level the page stops sending until the player speaks again.
/// </para>
///
/// <para>
/// NOTE: getUserMedia, AudioWorklet and WebCodecs all need a secure context. Whether the game's browser treats fw:// pages as one
/// could not be checked outside the game, so every step is feature-detected: a player without a usable microphone can still listen,
/// and a browser that cannot encode or decode Opus says so plainly. The reason is written to the browser console as well
/// ("Voice: ..."), which the client log shows as browserConsoleMessage.
/// </para>
///
/// </summary>
Owls.Voice = (() =>
{
	/// <summary>
	/// Opus at 48 kHz in 20 ms frames, mono.
	/// </summary>
	const sampleRate = 48000;
	const frameMicroseconds = 20000;

	/// <summary>
	/// Opus packets per network message (60 ms of voice).
	/// </summary>
	const packetsPerMessage = 3;

	/// <summary>
	/// Level (RMS, 0 - 1) under which a frame counts as silence, and how many silent frames in a row are still sent (500 ms),
	/// so the ends of words are not clipped.
	/// </summary>
	const silenceLevel = 0.006;
	const silenceHangoverFrames = 25;

	/// <summary>
	/// How far ahead incoming voice is scheduled, in seconds: enough to ride out network jitter, little enough to talk over.
	/// Voice that falls further behind than maxLatency is dropped to catch up.
	/// </summary>
	const targetLatency = 0.15;
	const maxLatency = 0.6;

	/// <summary>
	/// Level of decoded voice that counts as the other owl speaking, and how long the indicator stays lit after it.
	/// </summary>
	const speakingLevel = 0.02;
	const speakingHoldMs = 350;

	/// <summary>
	/// Where the capture worklet lives, next to this script, however the page itself was loaded.
	/// </summary>
	const workletUrl = new URL("VoiceCapture.js", document.currentScript ? document.currentScript.src : location.href).href;

	/// <summary>
	/// Microphone state as the call screen shows it: "off" (no call), "starting", "on", or "unavailable" with a text key in micProblem.
	/// </summary>
	const MicState = Object.freeze
	({
		Off: "off",
		Starting: "starting",
		On: "on",
		Unavailable: "unavailable",
	});

	let context = null;
	let output = null;
	let stream = null;
	let source = null;
	let capture = null;
	let encoder = null;
	let decoder = null;

	let callId = 0;
	let startToken = 0;
	let isMuted = false;
	let micState = MicState.Off;
	let micProblem = "";
	let hearProblem = "";
	let isWorkletLoaded = false;

	let pending = [];
	let sequence = 0;
	let quietFrames = 0;
	let encodeTimestamp = 0;
	let decodeTimestamp = 0;
	let nextPlayTime = 0;
	let speakingUntil = 0;
	let speakingTimer = null;

	/// <summary>
	/// Tell the screens that the voice state changed.
	/// </summary>
	function Notify()
	{
		Owls.Store.NotifyChanged("voice");
	}

	/// <summary>
	/// Log why voice could not start, for whoever reads the client log.
	/// </summary>
	/// <param name="text">What went wrong</param>
	/// <param name="error">Error, if any</param>
	function Warn(text, error = null)
	{
		console.warn(`Voice: ${text}${error ? ` (${error.name || "Error"}: ${error.message || error})` : ""}`);
	}

	/// <summary>
	/// What this browser is missing for Floo-Call voice, if anything.
	/// </summary>
	/// <returns>{ canSend, canHear, reason } where reason describes the first thing missing, for the log</returns>
	function Probe()
	{
		const hasAudio = typeof window.AudioContext === "function";
		const canHear = hasAudio && typeof window.AudioDecoder === "function" && typeof window.EncodedAudioChunk === "function";
		const canSend = canHear && !!window.isSecureContext && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function" && typeof window.AudioEncoder === "function" && typeof window.AudioWorkletNode === "function";

		let reason = "";

		if (!window.isSecureContext)
		{
			reason = `the page (${location.protocol}) is not a secure context, so the browser offers no microphone or Opus codec`;
		}
		else if (!canHear)
		{
			reason = "the browser has no WebCodecs AudioDecoder";
		}
		else if (!canSend)
		{
			reason = "the browser has no getUserMedia, AudioEncoder or AudioWorklet";
		}

		return { canSend, canHear, reason };
	}

	/// <summary>
	/// Create (or wake) the audio context. Call it from a click (Call, Answer) where possible, since browsers may refuse to start audio otherwise.
	/// </summary>
	function Prime()
	{
		if (typeof window.AudioContext !== "function")
		{
			return;
		}

		if (!context)
		{
			context = new AudioContext({ sampleRate, latencyHint: "interactive" });
			output = context.createGain();
			output.connect(context.destination);
			ApplyVolume();
		}

		if (context.state === "suspended")
		{
			context.resume().catch(() => {});
		}
	}

	/// <summary>
	/// Play the other owl's voice at the player's call volume.
	/// </summary>
	function ApplyVolume()
	{
		if (output)
		{
			output.gain.value = Math.min(1, Math.max(0, Number(Owls.Store.state.settings.callVolume ?? 1)));
		}
	}

	// ========================
	// Sending
	// ========================

	/// <summary>
	/// Send the packets gathered so far as one message.
	/// </summary>
	function Flush()
	{
		if (pending.length === 0 || callId === 0)
		{
			pending = [];
			return;
		}

		// Each packet is a 2-byte big-endian length followed by its bytes.
		let size = 0;

		for (const packet of pending)
		{
			size += 2 + packet.length;
		}

		const bytes = new Uint8Array(size);
		let offset = 0;

		for (const packet of pending)
		{
			bytes[offset] = packet.length >> 8;
			bytes[offset + 1] = packet.length & 0xff;
			bytes.set(packet, offset + 2);
			offset += 2 + packet.length;
		}

		pending = [];
		let binary = "";

		for (const byte of bytes)
		{
			binary += String.fromCharCode(byte);
		}

		sequence = (sequence + 1) % 1000000000;
		Owls.Bridge.Send("frantic-owls:voice", `${callId}|${sequence}|${btoa(binary)}`);
	}

	/// <summary>
	/// Take one 20 ms frame from the microphone: drop it as silence, or encode it.
	/// </summary>
	/// <param name="samples">960 samples at 48 kHz</param>
	function OnFrame(samples)
	{
		if (!encoder || encoder.state !== "configured" || isMuted || callId === 0)
		{
			return;
		}

		let sum = 0;

		for (const sample of samples)
		{
			sum += sample * sample;
		}

		quietFrames = Math.sqrt(sum / samples.length) < silenceLevel ? quietFrames + 1 : 0;

		if (quietFrames > silenceHangoverFrames)
		{
			// Whatever was gathered before the silence still goes.
			Flush();
			return;
		}

		const frame = new AudioData({ format: "f32-planar", sampleRate, numberOfFrames: samples.length, numberOfChannels: 1, timestamp: encodeTimestamp, data: samples });
		encodeTimestamp += frameMicroseconds;
		encoder.encode(frame);
		frame.close();
	}

	/// <summary>
	/// Collect one encoded Opus packet, and send once a message's worth is ready.
	/// </summary>
	/// <param name="chunk">EncodedAudioChunk</param>
	function OnEncoded(chunk)
	{
		const packet = new Uint8Array(chunk.byteLength);
		chunk.copyTo(packet);
		pending.push(packet);

		if (pending.length >= packetsPerMessage)
		{
			Flush();
		}
	}

	/// <summary>
	/// Open the microphone and the encoder for a call. Every await checks the token, so a call that ended meanwhile releases what it got.
	/// </summary>
	/// <param name="token">startToken when this start began</param>
	async function StartSending(token)
	{
		const IsStale = () => token !== startToken;

		try
		{
			const config = { codec: "opus", sampleRate, numberOfChannels: 1, bitrate: Number(Owls.Store.state.config.voiceBitrate) || 24000, opus: { frameDuration: frameMicroseconds } };
			const support = await AudioEncoder.isConfigSupported(config);

			if (IsStale())
			{
				return;
			}

			if (!support.supported)
			{
				throw Object.assign(new Error("Opus encoding is not supported"), { name: "NotSupportedError" });
			}

			const microphone = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });

			if (IsStale())
			{
				microphone.getTracks().forEach((track) => track.stop());
				return;
			}

			stream = microphone;

			if (!isWorkletLoaded)
			{
				await context.audioWorklet.addModule(workletUrl);
				isWorkletLoaded = true;
			}

			if (IsStale())
			{
				return;
			}

			encoder = new AudioEncoder({ output: OnEncoded, error: (error) => Warn("the Opus encoder failed", error) });
			encoder.configure(config);

			source = context.createMediaStreamSource(stream);
			capture = new AudioWorkletNode(context, "owl-voice-capture", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit" });
			capture.port.onmessage = (event) => OnFrame(event.data);
			source.connect(capture);

			micState = MicState.On;
			Notify();
		}
		catch (error)
		{
			if (IsStale())
			{
				return;
			}

			const name = error && error.name;
			micState = MicState.Unavailable;
			micProblem = name === "NotAllowedError" || name === "SecurityError" ? "call.voice.micDenied" : name === "NotFoundError" || name === "OverconstrainedError" ? "call.voice.noMic" : name === "NotSupportedError" ? "call.voice.listenOnly" : "call.voice.micFailed";
			Warn("the microphone could not be opened; the call is listen-only", error);
			StopSending();
			Notify();
		}
	}

	/// <summary>
	/// Release the microphone and the encoder. The microphone track is stopped, so the system's "in use" indicator goes away too.
	/// </summary>
	function StopSending()
	{
		if (capture)
		{
			capture.port.onmessage = null;
			capture.disconnect();
			capture = null;
		}

		if (source)
		{
			source.disconnect();
			source = null;
		}

		if (stream)
		{
			stream.getTracks().forEach((track) => track.stop());
			stream = null;
		}

		if (encoder && encoder.state !== "closed")
		{
			encoder.close();
		}

		encoder = null;
		pending = [];
		quietFrames = 0;
	}

	// ========================
	// Receiving
	// ========================

	/// <summary>
	/// Schedule one decoded frame of the other owl's voice.
	/// </summary>
	/// <param name="frame">AudioData from the decoder</param>
	function OnDecoded(frame)
	{
		if (!context || callId === 0)
		{
			frame.close();
			return;
		}

		const samples = new Float32Array(frame.numberOfFrames);
		frame.copyTo(samples, { planeIndex: 0, format: "f32-planar" });
		const frameRate = frame.sampleRate;
		frame.close();

		let sum = 0;

		for (const sample of samples)
		{
			sum += sample * sample;
		}

		if (Math.sqrt(sum / samples.length) > speakingLevel)
		{
			const wasSpeaking = Date.now() < speakingUntil;
			speakingUntil = Date.now() + speakingHoldMs;

			if (!wasSpeaking)
			{
				Notify();
				clearTimeout(speakingTimer);
				speakingTimer = setTimeout(function CheckSpeaking()
				{
					speakingTimer = Date.now() < speakingUntil ? setTimeout(CheckSpeaking, speakingUntil - Date.now() + 20) : null;

					if (speakingTimer === null)
					{
						Notify();
					}
				}, speakingHoldMs + 20);
			}
		}

		const now = context.currentTime;

		// Fell behind (a pause, or the other owl stopped sending through silence): start again a little ahead.
		if (nextPlayTime < now + 0.02)
		{
			nextPlayTime = now + targetLatency;
		}

		// Too far ahead (a burst after a network stall): drop this frame so the conversation catches up.
		if (nextPlayTime > now + maxLatency)
		{
			return;
		}

		const buffer = context.createBuffer(1, samples.length, frameRate);
		buffer.copyToChannel(samples, 0);
		const player = context.createBufferSource();
		player.buffer = buffer;
		player.connect(output);
		player.start(nextPlayTime);
		nextPlayTime += buffer.duration;
	}

	/// <summary>
	/// Take one voice message the server passed on from the other owl.
	/// </summary>
	/// <param name="message">"callId|sequence|base64 packets"</param>
	function Receive(message)
	{
		if (typeof message !== "string" || callId === 0 || !decoder || decoder.state !== "configured")
		{
			return;
		}

		const parts = message.split("|");

		if (parts.length !== 3 || Number(parts[0]) !== callId)
		{
			return;
		}

		// Malformed base64 throws; a broken message is simply skipped.
		let binary = "";

		try
		{
			binary = atob(parts[2]);
		}
		catch (error)
		{
			return;
		}

		let offset = 0;

		while (offset + 2 <= binary.length)
		{
			const length = (binary.charCodeAt(offset) << 8) | binary.charCodeAt(offset + 1);
			offset += 2;

			if (length === 0 || offset + length > binary.length)
			{
				return;
			}

			const packet = new Uint8Array(length);

			for (let index = 0; index < length; ++index)
			{
				packet[index] = binary.charCodeAt(offset + index);
			}

			offset += length;
			decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: decodeTimestamp, data: packet }));
			decodeTimestamp += frameMicroseconds;
		}
	}

	/// <summary>
	/// Open the decoder for a call.
	/// </summary>
	/// <returns>True when the other owl can be heard</returns>
	function StartHearing()
	{
		// configure throws on a codec the browser does not know; then the call simply has no sound.
		try
		{
			decoder = new AudioDecoder({ output: OnDecoded, error: (error) => Warn("the Opus decoder failed", error) });
			decoder.configure({ codec: "opus", sampleRate, numberOfChannels: 1 });
			return true;
		}
		catch (error)
		{
			Warn("Opus cannot be decoded here", error);
			decoder = null;
			return false;
		}
	}

	// ========================
	// Calls
	// ========================

	/// <summary>
	/// Start voice for an answered call. Starting the call already running does nothing.
	/// </summary>
	/// <param name="id">Call ID</param>
	/// <param name="startMuted">Whether the player is muted in this call (e.g. the page reloaded mid-call)</param>
	function Start(id, startMuted = false)
	{
		if (callId === id)
		{
			return;
		}

		Stop();
		callId = id;
		isMuted = startMuted;
		micProblem = "";
		hearProblem = "";
		sequence = 0;
		encodeTimestamp = 0;
		decodeTimestamp = 0;
		nextPlayTime = 0;

		if (Owls.Store.state.config.voiceEnabled === false)
		{
			micState = MicState.Unavailable;
			micProblem = "call.voice.off";
			Notify();
			return;
		}

		const probe = Probe();

		if (!probe.canHear)
		{
			Warn(`Floo-Call voice is unavailable: ${probe.reason}`);
			micState = MicState.Unavailable;
			micProblem = "call.voice.unsupported";
			hearProblem = "call.voice.unsupported";
			Notify();
			return;
		}

		Prime();

		if (!StartHearing())
		{
			hearProblem = "call.voice.unsupported";
		}

		if (!probe.canSend)
		{
			Warn(`the microphone is unavailable, so this call is listen-only: ${probe.reason}`);
			micState = MicState.Unavailable;
			micProblem = "call.voice.listenOnly";
			Notify();
			return;
		}

		micState = MicState.Starting;
		Notify();
		StartSending(++startToken);
	}

	/// <summary>
	/// End voice: the call ended, or the page was cleared.
	/// </summary>
	function Stop()
	{
		++startToken;

		if (callId === 0 && micState === MicState.Off)
		{
			return;
		}

		callId = 0;
		StopSending();

		if (decoder && decoder.state !== "closed")
		{
			decoder.close();
		}

		decoder = null;
		micState = MicState.Off;
		micProblem = "";
		hearProblem = "";
		isMuted = false;
		speakingUntil = 0;
		clearTimeout(speakingTimer);
		speakingTimer = null;

		// The context stays for the next call; suspending it stops it costing anything meanwhile.
		if (context && context.state === "running")
		{
			context.suspend().catch(() => {});
		}

		Notify();
	}

	/// <summary>
	/// Turn the microphone off or on. Muting sends what was gathered and then nothing until unmuted.
	/// </summary>
	/// <param name="muted">True to mute</param>
	function SetMuted(muted)
	{
		if (muted)
		{
			pending = [];
		}

		isMuted = muted;
		quietFrames = 0;
		Notify();
	}

	/// <summary>
	/// The voice state, for the call screen.
	/// </summary>
	/// <returns>{ micState, micProblem, hearProblem, isMuted, isOtherSpeaking }</returns>
	function GetState()
	{
		return { micState, micProblem, hearProblem, isMuted, isOtherSpeaking: callId !== 0 && Date.now() < speakingUntil };
	}

	window.addEventListener("frantic-owls:voice", (event) => Receive(event.detail));

	return { MicState, Prime, Start, Stop, SetMuted, ApplyVolume, GetState, Receive };
})();
