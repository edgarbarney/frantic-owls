// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Lock Screen
// ========================

/// <summary>
/// The screen shown each time the phone is taken out, over whatever was open when it was put away.
/// Muggle Phone shows a clock over the wallpaper with a fingerprint to touch; Parchment shows a sealed letter whose wax seal is broken to open it.
///
/// <para>
/// NOTE: It locks while the phone is put away rather than when it comes out, so the last screen never flashes up before the lock covers it.
/// Nothing behind it counts as seen while it is up: App.IsOpen() is false until it is unlocked, so chats are not marked read and missed calls stay new.
/// There is no password yet; Unlock() is the one place a check would go.
/// </para>
///
/// </summary>
Owls.LockScreen = (() =>
{
	const { Element } = Owls.Util;
	const T = Owls.Lang.T;

	/// <summary>
	/// How long the Muggle Phone lock slides away, and how long the letter takes to open, the seal cracking included.
	/// Both match the animations in Phone.css.
	/// </summary>
	const slideMs = 380;
	const letterMs = 1300;

	/// <summary>
	/// How long the fingerprint glows before the lock slides away.
	/// </summary>
	const scanMs = 320;

	const host = document.querySelector(".phone-screen");
	const element = Element("div", { className: "lock", attributes: { role: "dialog" } });
	host.appendChild(element);

	let isLocked = true;
	let isShown = false;
	let isOpening = false;
	let clockTimer = null;
	let openTimer = null;
	let OnUnlocked = () => {};

	/// <summary>
	/// The lines under the clock or the letter: unread owls, missed calls and informs waiting for an answer. Empty ones are left out.
	/// </summary>
	/// <returns>Element holding one line per kind, or null when there is nothing waiting</returns>
	function CreateNotes()
	{
		const lines = [];
		const unread = Owls.Store.GetTotalUnread();
		const missed = Owls.Store.GetMissedCallCount();
		const informs = Owls.Store.GetInformRequests().length;

		if (unread > 0)
		{
			lines.push({ icon: Owls.Icons.owl, text: T("lock.unread", { count: unread }) });
		}

		if (missed > 0)
		{
			lines.push({ icon: Owls.Icons.flame, text: T("lock.missedCalls", { count: missed }) });
		}

		if (informs > 0)
		{
			lines.push({ icon: Owls.Icons.inform, text: T("lock.informs", { count: informs }) });
		}

		if (lines.length === 0)
		{
			return null;
		}

		return Element("div", { className: "lock-notes" }, lines.map((line) =>
		{
			const icon = Element("span", { className: "lock-note-icon" });
			icon.innerHTML = line.icon;
			return Element("div", { className: "lock-note" }, [icon, Element("span", { text: line.text })]);
		}));
	}

	/// <summary>
	/// Build the Muggle Phone lock: the wallpaper, a large clock and the date, what is waiting, and the fingerprint at the bottom.
	/// </summary>
	/// <returns>Children of the lock element</returns>
	function CreateMuggle()
	{
		const url = String(Owls.Store.state.settings.wallpaperUrl || "");
		const wallpaper = Element("div", { className: "lock-wallpaper" });

		// The server only stores parsed https links, but JSON quoting keeps any character from ending the url() early.
		wallpaper.style.backgroundImage = url ? `url(${JSON.stringify(url)})` : "";

		const fingerprint = Element("button", { className: "lock-fingerprint", title: T("lock.unlock"), on: { click: () => Scan(fingerprint) } });
		fingerprint.innerHTML = Owls.Icons.fingerprint;

		return [
			wallpaper,
			Element("div", { className: "lock-clock", text: Owls.Util.FormatClock(Date.now()) }),
			Element("div", { className: "lock-date", text: Owls.Util.FormatLongDate(Date.now()) }),
			CreateNotes(),
			Element("div", { className: "lock-spacer" }),
			fingerprint,
			Element("div", { className: "lock-hint", text: T("lock.touchHint") }),
		];
	}

	/// <summary>
	/// Build the Parchment lock: a letter addressed to the character, closed with a wax seal.
	/// </summary>
	/// <returns>Children of the lock element</returns>
	function CreateLetter()
	{
		const name = Owls.Store.state.me.name;
		const seal = Element("button", { className: "wax-seal", title: T("lock.breakSeal"), on: { click: () => Unlock(true) } });

		// Two copies of the seal, each showing one half, so it can crack in two when broken.
		for (const side of ["is-left", "is-right"])
		{
			const half = Element("span", { className: `wax-seal-half ${side}` });
			half.innerHTML = Owls.Icons.waxSeal;
			seal.appendChild(half);
		}

		return [
			Element("div", { className: "letter-heading", text: name ? T("lock.letterFor", { name }) : T("lock.letterForYou") }),
			Element("div", { className: "letter-date", text: T("lock.letterDate", { date: Owls.Util.FormatLongDate(Date.now()), time: Owls.Util.FormatClock(Date.now()) }) }),
			Element("div", { className: "envelope" },
			[
				Element("div", { className: "envelope-back" }),
				Element("div", { className: "envelope-letter" }, [Element("span"), Element("span"), Element("span")]),
				Element("div", { className: "envelope-front" }),
				Element("div", { className: "envelope-flap" }),
				seal,
			]),
			CreateNotes(),
			Element("div", { className: "lock-spacer" }),
			Element("div", { className: "lock-hint", text: T("lock.sealHint") }),
		];
	}

	/// <summary>
	/// Draw the lock for the theme in effect, with the time and counts as they are now.
	/// </summary>
	function Render()
	{
		if (isOpening)
		{
			return;
		}

		const isLetter = Owls.Store.GetTheme() === "parchment";
		element.className = `lock ${isLetter ? "is-letter" : "is-muggle"}`;
		element.replaceChildren(...(isLetter ? CreateLetter() : CreateMuggle()).filter(Boolean));
	}

	/// <summary>
	/// Keep the clock on the minute while the lock is on screen.
	/// </summary>
	function StartClock()
	{
		StopClock();
		clockTimer = setInterval(() =>
		{
			const clock = element.querySelector(".lock-clock");
			const date = element.querySelector(".letter-date");

			if (clock)
			{
				clock.textContent = Owls.Util.FormatClock(Date.now());
			}

			if (date)
			{
				date.textContent = T("lock.letterDate", { date: Owls.Util.FormatLongDate(Date.now()), time: Owls.Util.FormatClock(Date.now()) });
			}
		}, 1000);
	}

	/// <summary>
	/// Stop the clock.
	/// </summary>
	function StopClock()
	{
		clearInterval(clockTimer);
		clockTimer = null;
	}

	/// <summary>
	/// Take the lock away at once, without telling the app (for a call taking over the screen as the phone opens).
	/// </summary>
	function Hide()
	{
		clearTimeout(openTimer);
		openTimer = null;
		isLocked = false;
		isOpening = false;
		element.hidden = true;
		element.classList.remove("is-opening", "is-scanning");
		StopClock();
	}

	/// <summary>
	/// Let the fingerprint glow for a moment, as if read, then unlock.
	/// </summary>
	/// <param name="button">The fingerprint button</param>
	function Scan(button)
	{
		if (isOpening)
		{
			return;
		}

		button.classList.add("is-scanning");
		openTimer = setTimeout(() => Unlock(true), scanMs);
	}

	// ========================
	// Public
	// ========================

	/// <summary>
	/// Whether the lock is used at all: the server allows it (ui.lockScreen) and the player has not turned it off.
	/// </summary>
	/// <returns>True when the phone locks</returns>
	function IsEnabled()
	{
		const ui = Owls.Store.state.config.ui || {};
		return ui.lockScreen !== false && Owls.Store.state.settings.lockScreen !== false;
	}

	/// <summary>
	/// Whether the lock covers the phone (or is still opening, which already counts as unlocked).
	/// </summary>
	/// <returns>True while locked</returns>
	function IsLocked()
	{
		return isLocked;
	}

	/// <summary>
	/// Cover the phone, if the lock is used. Called while the phone is put away.
	/// </summary>
	function Lock()
	{
		if (!IsEnabled())
		{
			Hide();
			return;
		}

		clearTimeout(openTimer);
		openTimer = null;
		isLocked = true;
		isOpening = false;
		element.hidden = false;
		Render();
	}

	/// <summary>
	/// Open the lock and show what is behind it.
	/// On Muggle Phone it slides up out of the way (or simply goes, with animations off); on Parchment the seal cracks and the letter opens.
	/// </summary>
	/// <param name="animate">False to take it away at once</param>
	function Unlock(animate = true)
	{
		if (!isLocked)
		{
			return;
		}

		// TODO: Ask for the player's password here, once the phone has one.
		const isLetter = element.classList.contains("is-letter");
		const duration = !animate ? 0 : isLetter ? letterMs : Owls.Store.state.settings.animations === false ? 0 : slideMs;

		isLocked = false;
		OnUnlocked();

		// Only the player opening it makes the sound; a call taking over the screen does not.
		if (animate)
		{
			Owls.Effects.Play("unlock");
		}

		if (duration === 0)
		{
			Hide();
			return;
		}

		isOpening = true;
		element.classList.add("is-opening");
		clearTimeout(openTimer);
		openTimer = setTimeout(Hide, duration);
	}

	/// <summary>
	/// The phone was taken out. Brings the lock up to date, or takes it away when it is not used or a call takes over the screen.
	/// </summary>
	/// <returns>True when the lock is on screen, so the app waits for it to open before treating the phone as looked at</returns>
	function OnOpened()
	{
		isShown = true;

		if (isLocked && (!IsEnabled() || Owls.Store.state.call))
		{
			Hide();
		}

		if (!isLocked)
		{
			return false;
		}

		Render();
		StartClock();
		return true;
	}

	/// <summary>
	/// The phone was put away (its closing animation has finished), so it locks for next time.
	/// </summary>
	function OnClosed()
	{
		isShown = false;
		Lock();
		StopClock();
	}

	/// <summary>
	/// Redraw for store changes the lock shows: the theme, wallpaper, language and the counts of what is waiting.
	/// </summary>
	/// <param name="reason">Change reason from the store</param>
	function Refresh(reason)
	{
		if (!isLocked || isOpening)
		{
			return;
		}

		// Turned off while the lock was up; behind it the phone only counts as looked at if it is out.
		if ((reason === "settings" || reason === "reset" || reason === "ready") && !IsEnabled())
		{
			Hide();

			if (isShown)
			{
				OnUnlocked();
			}

			return;
		}

		if (reason === "settings" || reason === "reset" || reason === "ready" || reason === "chats" || reason === "calls" || reason === "informs")
		{
			Render();
		}
	}

	/// <summary>
	/// Set what happens once the phone is unlocked (the app treats it as looked at from then on).
	/// </summary>
	/// <param name="callback">Function called on every unlock</param>
	function SetOnUnlocked(callback)
	{
		OnUnlocked = callback;
	}

	// Enter or Space opens the lock, like tapping it.
	window.addEventListener("keydown", (event) =>
	{
		if (!isShown || !isLocked || (event.key !== "Enter" && event.key !== " "))
		{
			return;
		}

		event.preventDefault();
		const fingerprint = element.querySelector(".lock-fingerprint");

		if (fingerprint)
		{
			Scan(fingerprint);
		}
		else
		{
			Unlock(true);
		}
	});

	Render();
	return { IsEnabled, IsLocked, Lock, Unlock, OnOpened, OnClosed, Refresh, SetOnUnlocked };
})();
