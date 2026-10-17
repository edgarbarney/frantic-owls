// FranticDreamer 2026
"use strict";

// ========================
// Voice Capture Worklet
// ========================

/// <summary>
/// Number of samples in one Opus frame: 20 ms at 48 kHz.
/// </summary>
const frameSamples = 960;

/// <summary>
/// Runs on the audio thread: gathers the microphone's 128-sample render quanta into 20 ms frames and hands each one to Voice.js.
/// Only the first channel is kept; the microphone is asked for mono anyway.
///
/// <para>
/// NOTE: Each frame's buffer is transferred rather than copied, so a fresh one is allocated per frame (50 a second), which is cheap.
/// This file is loaded with audioWorklet.addModule, so it cannot see the page's Owls namespace or anything else on window.
/// </para>
///
/// </summary>
class OwlVoiceCapture extends AudioWorkletProcessor
{
	/// <summary>
	/// The frame being filled, and how many samples it holds so far.
	/// </summary>
	#frame = new Float32Array(frameSamples);
	#filled = 0;

	/// <summary>
	/// Collect one render quantum.
	/// </summary>
	/// <param name="inputs">The microphone's channels</param>
	/// <returns>True, to keep running while the call lasts</returns>
	process(inputs)
	{
		const input = inputs[0];

		if (!input || input.length === 0)
		{
			return true;
		}

		for (const sample of input[0])
		{
			this.#frame[this.#filled++] = sample;

			if (this.#filled === frameSamples)
			{
				this.port.postMessage(this.#frame, [this.#frame.buffer]);
				this.#frame = new Float32Array(frameSamples);
				this.#filled = 0;
			}
		}

		return true;
	}
}

registerProcessor("owl-voice-capture", OwlVoiceCapture);
