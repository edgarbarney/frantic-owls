// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Sound Effects
// ========================

/// <summary>
/// The phone's own small sounds, apart from notification sounds and ringtones: a tap for each key typed (and another for each one erased),
/// a tap for opening an app from the home screen, locking and unlocking, and an owl sent or arriving in the chat on screen.
/// The server names the files for each theme (the "effects" section; a missing one is silent) and each player can turn them off or set their volume.
///
/// <para>
/// NOTE: Carried over from the Frantic_Phone resource for FiveM, where each cue was one audio element rewound and played again,
/// so a key held down or typed fast restarts its tap rather than piling up overlapping copies. The same is done here.
/// Owls arriving in a chat that is not on screen get the notification sound instead, never this one, and Do Not Disturb keeps that one quiet too.
/// </para>
///
/// </summary>
Owls.Effects = (() =>
{
	/// <summary>
	/// One audio element per effect, created the first time it plays: { file, audio } by effect name.
	/// </summary>
	const players = new Map();

	/// <summary>
	/// Keys that erase rather than type.
	/// </summary>
	const eraseKeys = Object.freeze(["Backspace", "Delete"]);

	/// <summary>
	/// Play one effect, if the server has it and the player keeps sound effects on.
	/// </summary>
	/// <param name="name">"keyTap", "keyEraseTap", "appTap", "lock", "unlock", "messageSent" or "messageReceived"</param>
	function Play(name)
	{
		// Each theme has its own set, so Parchment never makes a Muggle phone's clicks.
		const settings = Owls.Store.state.settings;
		const effects = (Owls.Store.state.config.effects || {})[Owls.Store.GetTheme()] || {};
		const file = String(effects[name] || "");

		if (!file || settings.soundEffects === false)
		{
			return;
		}

		// An arriving owl is news rather than feedback on something the player did, so it keeps quiet with the notifications.
		if (name === "messageReceived" && Owls.Store.IsQuiet())
		{
			return;
		}

		// Kept by the configured path rather than compared with audio.src, which the browser turns into a full address.
		let entry = players.get(name);

		if (!entry || entry.file !== file)
		{
			entry = { file, audio: new Audio(file) };
			players.set(name, entry);
		}

		const player = entry.audio;
		player.volume = Math.min(1, Math.max(0, Number(settings.effectsVolume ?? 0.5)));
		player.currentTime = 0;

		// play() rejects when the browser refuses playback; a missed tap is not worth surfacing.
		player.play().catch(() => {});
	}

	/// <summary>
	/// Whether a key press lands in a text field of the phone that takes typing.
	/// </summary>
	/// <param name="target">Event target</param>
	/// <returns>True for an editable text field or text area inside the phone</returns>
	function IsTypingField(target)
	{
		if (!target || !target.closest || !target.closest("#phone") || target.disabled || target.readOnly)
		{
			return false;
		}

		return target.tagName === "TEXTAREA" || (target.tagName === "INPUT" && (target.type === "text" || target.type === "search"));
	}

	// Frantic_Phone listened for keys in its text fields the same way, with Backspace as the erasing key.
	document.addEventListener("keydown", (event) =>
	{
		if (!IsTypingField(event.target) || event.ctrlKey || event.metaKey || event.altKey)
		{
			return;
		}

		if (eraseKeys.includes(event.key))
		{
			// Erasing an empty field does nothing, so it makes no sound either.
			if (event.target.value.length > 0)
			{
				Play("keyEraseTap");
			}

			return;
		}

		// One character per printable key; Enter, arrows and the like are not typing.
		if (event.key.length === 1)
		{
			Play("keyTap");
		}
	}, true);

	return { Play };
})();
