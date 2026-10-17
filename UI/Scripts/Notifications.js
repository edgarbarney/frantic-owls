// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Notifications
// ========================

/// <summary>
/// How an incoming owl is announced.
/// Phone closed: a small square pops up at the side of the screen for a few seconds (to be replaced with an animation later).
/// Phone open: a banner drops in from the top of the phone screen, like a phone notification; tapping it opens the chat.
/// Either way the notification sound plays, if the player has it on.
/// Do Not Disturb, or a quiet activity such as a duel, holds all of it back; the owl still arrives and counts as unread.
/// An incoming Floo-Call rings: the player's ringtone repeats and the pop-up square stays (with a flame in place of the owl) until it is answered or ends.
/// Ringtones have their own choice and volume, apart from the notification sound, so turning notification sounds off does not silence calls; Do Not Disturb does.
/// While a Floo-Call is answered the view stays on screen (showing nothing while the phone is closed): a hidden view is throttled by the browser,
/// which must not happen to the call's voice.
///
/// <para>
/// NOTE: While the phone is closed its view is hidden, and the client script shows it whenever an owl arrives.
/// The page must therefore always report when it no longer needs the screen ("overlay" inactive), even when it decided to show nothing,
/// or the view would stay on screen doing nothing but costing render time.
/// </para>
///
/// </summary>
Owls.Notifications = (() =>
{
	/// <summary>
	/// Extra time after a pop-up ends before the view is released, so its leave animation finishes.
	/// </summary>
	const leaveAnimationMs = 260;

	/// <summary>
	/// How long the view is kept for a sound alone, roughly the length of the hoot.
	/// </summary>
	const soundOnlyMs = 1400;

	/// <summary>
	/// Pause before a ringtone plays again, so a short sound rings rather than running into itself.
	/// </summary>
	const ringGapMs = 700;

	/// <summary>
	/// Gap between two rings when the server plays its Wwise event instead of a ringtone file.
	/// </summary>
	const wwiseRingIntervalMs = 2500;

	let isPhoneOpen = false;
	let toastTimer = null;
	let bannerTimer = null;
	let releaseTimer = null;
	let bannerAction = null;

	/// <summary>
	/// Label of the pop-up while a call rings ("" while none does), and the timer repeating its sound.
	/// </summary>
	let ringLabel = "";
	let ringTimer = null;

	/// <summary>
	/// Timer that ends a ringtone preview from Settings, or null while none plays.
	/// </summary>
	let previewTimer = null;

	/// <summary>
	/// True while a Floo-Call is answered, which keeps the view on screen.
	/// </summary>
	let isCallHeld = false;

	const toast = document.getElementById("toast");
	const toastLabel = document.getElementById("toast-label");
	const banner = document.getElementById("banner");
	const bannerAvatar = document.getElementById("banner-avatar");
	const bannerTitle = document.getElementById("banner-title");
	const bannerBody = document.getElementById("banner-body");
	const sound = document.getElementById("owl-sound");
	const ringSound = document.getElementById("ring-sound");

	const toastIcon = toast.querySelector(".toast-icon");
	toastIcon.innerHTML = Owls.Icons.owl;

	/// <summary>
	/// Tell the client script whether the page still needs to be on screen while the phone is closed.
	/// </summary>
	/// <param name="active">True while a pop-up or sound is running</param>
	function SetOverlay(active)
	{
		clearTimeout(releaseTimer);
		releaseTimer = null;
		Owls.Bridge.Send("frantic-owls:overlay", { active });
	}

	/// <summary>
	/// Release the view after a delay, unless something new arrives first.
	/// </summary>
	/// <param name="delayMs">Delay in milliseconds</param>
	function ReleaseOverlayAfter(delayMs)
	{
		clearTimeout(releaseTimer);
		releaseTimer = setTimeout(() =>
		{
			releaseTimer = null;

			if (!isPhoneOpen && toast.hidden && !ringLabel && !isCallHeld)
			{
				SetOverlay(false);
			}
		}, delayMs);
	}

	/// <summary>
	/// The sound file of a notification sound, falling back to the server's default for an ID it no longer offers.
	/// </summary>
	/// <param name="soundId">Sound ID, or "" for the default</param>
	/// <returns>Path inside UI/, or "" when the server offers none</returns>
	function GetSoundFile(soundId)
	{
		const config = Owls.Store.state.config;
		const sounds = Array.isArray(config.sounds) ? config.sounds : [];
		const chosen = sounds.find((entry) => entry.id === soundId) || sounds.find((entry) => entry.id === config.defaultSound) || sounds[0];
		return chosen ? chosen.file : "";
	}

	/// <summary>
	/// Play the notification sound, honouring the player's settings and the server's sound mode.
	/// </summary>
	/// <param name="previewId">Sound ID to try out from Settings: plays even with notification sounds off; omitted for a real notification</param>
	function PlaySound(previewId)
	{
		const settings = Owls.Store.state.settings;
		const config = Owls.Store.state.config;
		const isPreview = typeof previewId === "string";

		if (!settings.notificationSound && !isPreview)
		{
			return;
		}

		switch (config.soundMode)
		{
		case "file":
		{
			const file = GetSoundFile(isPreview ? previewId : settings.sound);

			if (!file)
			{
				return;
			}

			if (!sound.src.endsWith(file))
			{
				sound.src = file;
			}

			sound.volume = Math.min(1, Math.max(0, Number(settings.notificationVolume)));
			sound.currentTime = 0;

			// play() rejects when the browser refuses playback; a missed sound is not worth surfacing.
			sound.play().catch(() => {});
			break;
		}
		case "wwise":
			Owls.Bridge.Send("frantic-owls:sound", null);
			break;
		default:
			break;
		}
	}

	/// <summary>
	/// The file of a ringtone, falling back to the server's default for an ID it no longer offers.
	/// </summary>
	/// <param name="ringtoneId">Ringtone ID, or "" for the default</param>
	/// <returns>Path inside UI/, or "" when the server offers none</returns>
	function GetRingtoneFile(ringtoneId)
	{
		const config = Owls.Store.state.config;
		const ringtones = Array.isArray(config.ringtones) ? config.ringtones : [];
		const chosen = ringtones.find((entry) => entry.id === ringtoneId) || ringtones.find((entry) => entry.id === config.defaultRingtone) || ringtones[0];
		return chosen ? chosen.file : "";
	}

	/// <summary>
	/// Stop the ringtone, whether it rings for a call or plays as a preview.
	/// </summary>
	function StopRingtone()
	{
		clearTimeout(ringTimer);
		clearInterval(ringTimer);
		clearTimeout(previewTimer);
		ringTimer = null;
		previewTimer = null;
		ringSound.onended = null;
		ringSound.pause();
	}

	/// <summary>
	/// Play a ringtone file at the player's ringtone volume.
	/// </summary>
	/// <param name="ringtoneId">Ringtone ID, or "" for the default</param>
	/// <param name="isRepeating">Play it again after a short pause each time it ends, until StopRingtone</param>
	function PlayRingtone(ringtoneId, isRepeating)
	{
		const file = GetRingtoneFile(ringtoneId);

		if (!file)
		{
			return;
		}

		if (!ringSound.src.endsWith(file))
		{
			ringSound.src = file;
		}

		ringSound.volume = Math.min(1, Math.max(0, Number(Owls.Store.state.settings.ringtoneVolume ?? 0.8)));
		ringSound.currentTime = 0;
		ringSound.onended = isRepeating ? () =>
		{
			ringTimer = setTimeout(() =>
			{
				ringSound.currentTime = 0;
				ringSound.play().catch(() => {});
			}, ringGapMs);
		} : null;

		// play() rejects when the browser refuses playback; a missed ring is not worth surfacing.
		ringSound.play().catch(() => {});
	}

	/// <summary>
	/// Play a ringtone once, to try it out from Settings. Does nothing while a call is really ringing.
	/// </summary>
	/// <param name="ringtoneId">Ringtone ID, or "" for the default</param>
	function PreviewRingtone(ringtoneId)
	{
		if (ringLabel)
		{
			return;
		}

		StopRingtone();
		PlayRingtone(ringtoneId, false);
	}

	/// <summary>
	/// Stop a ringtone preview (the player left the page or picked another), leaving a real call's ringing alone.
	/// </summary>
	function StopPreview()
	{
		if (!ringLabel)
		{
			StopRingtone();
		}
	}

	/// <summary>
	/// Show (or refresh) the closed-phone pop-up square.
	/// </summary>
	/// <param name="label">Short text under the owl icon, usually the sender</param>
	/// <param name="isRinging">Keep it up with a ringing phone in place of the owl, until StopRinging takes it down</param>
	function ShowToast(label, isRinging = false)
	{
		clearTimeout(toastTimer);
		toastTimer = null;
		toast.classList.remove("is-leaving");
		toast.classList.toggle("is-ringing", isRinging);
		toastIcon.innerHTML = isRinging ? Owls.Icons.flame : Owls.Icons.owl;
		toastLabel.textContent = label;
		toast.hidden = false;
		SetOverlay(true);

		if (isRinging)
		{
			return;
		}

		toastTimer = setTimeout(() =>
		{
			toast.classList.add("is-leaving");
			toastTimer = setTimeout(() =>
			{
				toast.hidden = true;
				toast.classList.remove("is-leaving");
				toastTimer = null;
				ReleaseOverlayAfter(0);
			}, leaveAnimationMs);
		}, Owls.Store.state.config.toastDurationMs || 3000);
	}

	/// <summary>
	/// Hide the pop-up square at once (e.g. the phone was opened).
	/// </summary>
	function HideToast()
	{
		clearTimeout(toastTimer);
		toastTimer = null;
		toast.hidden = true;
		toast.classList.remove("is-leaving", "is-ringing");
	}

	/// <summary>
	/// Drop the in-phone banner from the top.
	/// </summary>
	/// <param name="avatar">Avatar element</param>
	/// <param name="title">Bold first line</param>
	/// <param name="body">Second line</param>
	/// <param name="onClick">Called when the banner is tapped (optional)</param>
	function ShowBanner(avatar, title, body, onClick)
	{
		clearTimeout(bannerTimer);
		banner.classList.remove("is-leaving");
		bannerAvatar.replaceChildren(avatar);
		bannerTitle.textContent = title;
		bannerBody.textContent = body;
		bannerAction = onClick || null;
		banner.hidden = false;

		bannerTimer = setTimeout(HideBanner, Owls.Store.state.config.bannerDurationMs || 4000);
	}

	/// <summary>
	/// Slide the banner away.
	/// </summary>
	function HideBanner()
	{
		clearTimeout(bannerTimer);
		banner.classList.add("is-leaving");
		bannerTimer = setTimeout(() =>
		{
			banner.hidden = true;
			banner.classList.remove("is-leaving");
			bannerAction = null;
		}, leaveAnimationMs);
	}

	banner.addEventListener("click", () =>
	{
		const action = bannerAction;
		HideBanner();

		if (action)
		{
			action();
		}
	});

	/// <summary>
	/// Announce something to the player in whichever way fits the phone's state.
	/// </summary>
	/// <param name="notification">{ title, body, avatar: () => Element, onClick, silent }</param>
	function Announce(notification)
	{
		if (Owls.Store.IsQuiet())
		{
			ReleaseIfIdle();
			return;
		}

		if (!notification.silent)
		{
			PlaySound();
		}

		if (isPhoneOpen)
		{
			ShowBanner(notification.avatar(), notification.title, notification.body, notification.onClick);
			return;
		}

		// A ringing call keeps its own pop-up; anything else that arrives meanwhile only makes its sound.
		if (ringLabel)
		{
			return;
		}

		if (Owls.Store.state.settings.popups)
		{
			ShowToast(notification.title);
			return;
		}

		// No pop-up wanted; keep the view only as long as the sound needs it.
		ReleaseOverlayAfter(notification.silent ? 0 : soundOnlyMs);
	}

	/// <summary>
	/// Called when the client may have shown the view for nothing (e.g. an owl for the chat being read while the phone closed).
	/// </summary>
	function ReleaseIfIdle()
	{
		if (!isPhoneOpen && toast.hidden && !ringLabel && !isCallHeld && releaseTimer === null)
		{
			ReleaseOverlayAfter(0);
		}
	}

	/// <summary>
	/// Keep the view on screen for a Floo-Call in progress, or let it go when the call ends.
	/// </summary>
	/// <param name="held">True while a call is answered</param>
	function SetCallHold(held)
	{
		if (isCallHeld === held)
		{
			return;
		}

		isCallHeld = held;

		if (held && !isPhoneOpen)
		{
			SetOverlay(true);
		}
		else if (!held)
		{
			ReleaseIfIdle();
		}
	}

	/// <summary>
	/// Ring for an incoming call until StopRinging: the player's ringtone, over and over, and a pop-up that stays while the phone is closed.
	/// Do Not Disturb (or a quiet activity) rings silently, with nothing on screen; the call can still be answered from the phone.
	/// </summary>
	/// <param name="label">Who is calling, for the pop-up</param>
	function StartRinging(label)
	{
		StopRinging();
		StopRingtone();

		if (Owls.Store.IsQuiet())
		{
			ReleaseIfIdle();
			return;
		}

		ringLabel = label || " ";

		switch (Owls.Store.state.config.soundMode)
		{
		case "file":
			PlayRingtone(Owls.Store.state.settings.ringtone || "", true);
			break;
		case "wwise":
			Owls.Bridge.Send("frantic-owls:sound", null);
			ringTimer = setInterval(() => Owls.Bridge.Send("frantic-owls:sound", null), wwiseRingIntervalMs);
			break;
		default:
			break;
		}

		if (!isPhoneOpen)
		{
			// With pop-ups off the view stays only for the sound; it is released when the ringing stops.
			if (Owls.Store.state.settings.popups)
			{
				ShowToast(ringLabel, true);
			}
			else
			{
				SetOverlay(true);
			}
		}
	}

	/// <summary>
	/// Stop ringing: the call was answered, declined or ended.
	/// </summary>
	function StopRinging()
	{
		if (!ringLabel)
		{
			return;
		}

		StopRingtone();
		ringLabel = "";

		if (toast.classList.contains("is-ringing"))
		{
			HideToast();
		}

		ReleaseIfIdle();
	}

	/// <summary>
	/// Track whether the phone is open, which decides between banners and pop-ups.
	/// </summary>
	/// <param name="open">True while the phone is open</param>
	function SetPhoneOpen(open)
	{
		isPhoneOpen = open;

		if (open)
		{
			HideToast();
			SetOverlay(false);
		}
		else
		{
			banner.hidden = true;

			// Closing the phone on a call that is still ringing brings its pop-up back.
			if (ringLabel && Owls.Store.state.settings.popups)
			{
				ShowToast(ringLabel, true);
			}
			else if (ringLabel || isCallHeld)
			{
				SetOverlay(true);
			}
		}
	}

	return { Announce, ReleaseIfIdle, SetPhoneOpen, PlaySound, StartRinging, StopRinging, PreviewRingtone, StopPreview, SetCallHold };
})();
