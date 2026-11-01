// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// App
// ========================

/// <summary>
/// Navigation and wiring of the phone page: a stack of screens with Home at the bottom,
/// the handlers for everything the server pushes, and the open/close lifecycle.
/// </summary>
Owls.App = (() =>
{
	const Store = Owls.Store;
	const Bridge = Owls.Bridge;
	const Notifications = Owls.Notifications;
	const T = Owls.Lang.T;

	/// <summary>
	/// Base font size in pixels at scale 1. Every size in the stylesheet is in rem.
	/// </summary>
	const baseFontPx = 16;

	/// <summary>
	/// Length of the close animation (phone-out in Phone.css).
	/// </summary>
	const closeAnimationMs = 200;

	/// <summary>
	/// Length of an app growing out of its home screen icon, or shrinking back into it (Muggle Phone only).
	/// </summary>
	const appMotionMs = 360;

	/// <summary>
	/// How long the home screen icons take to fall into place when the phone comes up, the last one's delay included.
	/// </summary>
	const fallInMs = 760;

	/// <summary>
	/// Corner radius of a home screen icon in px at scale 1, matching .home-tile-icon in Phone.css.
	/// </summary>
	const iconRadiusPx = 15;

	const phone = document.getElementById("phone");
	const screenHost = document.getElementById("screen");
	const quietIndicator = document.getElementById("status-quiet");
	const callIndicator = document.getElementById("status-call");
	const callIndicatorText = document.getElementById("status-call-text");
	const wallpaper = document.getElementById("wallpaper");

	/// <summary>
	/// Open screens, bottom first: [{ name, params, instance }].
	/// Screens below the top stay alive so going back returns to them as they were.
	/// </summary>
	const stack = [];

	let isOpen = false;
	let closeTimer = null;
	let fallTimer = null;

	/// <summary>
	/// Timer redrawing the status bar's call timer, while a call in progress is shown there.
	/// </summary>
	let callIndicatorTimer = null;

	/// <summary>
	/// The app opening or closing right now: { animation, Cleanup }, or null.
	/// </summary>
	let motion = null;

	// ========================
	// Navigation
	// ========================

	/// <summary>
	/// The visible screen.
	/// </summary>
	/// <returns>Stack entry, or null</returns>
	function GetTop()
	{
		return stack.length > 0 ? stack[stack.length - 1] : null;
	}

	/// <summary>
	/// Put the top screen into the phone.
	/// </summary>
	function ShowTop()
	{
		FinishMotion();

		const top = GetTop();
		screenHost.replaceChildren(top ? top.instance.element : document.createTextNode(""));
		UpdateWallpaper();
		UpdateCallIndicator();
	}

	/// <summary>
	/// Show the player's wallpaper behind the home screen (and behind an app growing out of it or shrinking into it), and nowhere else.
	/// </summary>
	function UpdateWallpaper()
	{
		const top = GetTop();
		const url = String(Store.state.settings.wallpaperUrl || "");
		wallpaper.hidden = !url || !top || (top.name !== "Home" && motion === null);

		// The server only stores parsed https links, but JSON quoting keeps any character from ending the url() early.
		wallpaper.style.backgroundImage = url ? `url(${JSON.stringify(url)})` : "";
	}

	// ========================
	// App Motion
	// ========================

	/// <summary>
	/// Whether apps open and close with motion: the Muggle Phone theme only, as Parchment is a sheet of paper rather than a phone,
	/// and only while the player keeps Animations on in Settings.
	/// </summary>
	/// <returns>True on Muggle Phone with animations on</returns>
	function HasMotion()
	{
		return Store.GetTheme() !== "parchment" && Store.state.settings.animations !== false && typeof Element.prototype.animate === "function";
	}

	/// <summary>
	/// End an app's opening or closing at once, e.g. because the player tapped on before it finished.
	/// </summary>
	function FinishMotion()
	{
		if (motion === null)
		{
			return;
		}

		const finished = motion;
		motion = null;
		finished.animation.cancel();
		finished.Cleanup();
	}

	/// <summary>
	/// Where an app's icon sits on the home screen, as insets from each edge of the screen area.
	/// The home screen must be in the page to be measured.
	/// </summary>
	/// <param name="name">Screen the icon opens</param>
	/// <returns>{ top, right, bottom, left, centreX, centreY }, or null when there is no such icon</returns>
	function GetIconInsets(name)
	{
		const icon = screenHost.querySelector(`.home-tile[data-screen="${name}"] .home-tile-icon`);

		if (!icon)
		{
			return null;
		}

		const host = screenHost.getBoundingClientRect();
		const rect = icon.getBoundingClientRect();

		return {
			top: rect.top - host.top,
			right: host.right - rect.right,
			bottom: host.bottom - rect.bottom,
			left: rect.left - host.left,
			centreX: rect.left - host.left + rect.width / 2,
			centreY: rect.top - host.top + rect.height / 2,
		};
	}

	/// <summary>
	/// Keyframe of an app squeezed into its icon: clipped to the icon's rounded square, slightly smaller and see-through.
	/// </summary>
	/// <param name="insets">Icon insets from GetIconInsets</param>
	/// <param name="opacity">Opacity at that moment</param>
	/// <returns>Keyframe</returns>
	function IconFrame(insets, opacity)
	{
		const radius = iconRadiusPx * (parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1);
		return { clipPath: `inset(${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px round ${radius}px)`, transform: "scale(0.86)", opacity };
	}

	/// <summary>
	/// Play an app moving over the home screen, then show whatever is on top of the stack.
	///
	/// <para>
	/// NOTE: The screen area holds both screens while it plays: the home screen underneath, where it was, and the moving app on top of it.
	/// Clipping (clip-path) rather than scaling is what makes the app grow out of its icon, so its content is never squashed while it opens.
	/// </para>
	///
	/// </summary>
	/// <param name="home">Home screen element</param>
	/// <param name="app">Element of the app opening or closing</param>
	/// <param name="frames">Keyframes for the app</param>
	/// <param name="origin">{ centreX, centreY } the app grows from or shrinks into</param>
	function PlayMotion(home, app, frames, origin)
	{
		FinishMotion();

		app.classList.add("is-moving");
		app.style.transformOrigin = `${origin.centreX}px ${origin.centreY}px`;
		screenHost.replaceChildren(home, app);

		const animation = app.animate(frames, { duration: appMotionMs, easing: "cubic-bezier(0.2, 0.85, 0.25, 1)", fill: "both" });

		// A browser that stops drawing (the view hidden mid-way) also stops the animation clock, so a timer makes sure the app never stays half-open.
		const fallback = setTimeout(() =>
		{
			if (motion && motion.animation === animation)
			{
				FinishMotion();
			}
		}, appMotionMs + 250);

		motion =
		{
			animation,
			Cleanup: () =>
			{
				clearTimeout(fallback);
				app.classList.remove("is-moving");
				app.style.transformOrigin = "";
				ShowTop();
			},
		};

		UpdateWallpaper();
		animation.onfinish = () =>
		{
			if (motion && motion.animation === animation)
			{
				FinishMotion();
			}
		};
	}

	/// <summary>
	/// Open an app from the home screen. On Muggle Phone it grows out of its icon, like a phone's apps.
	/// </summary>
	/// <param name="name">Screen module name of the app</param>
	function OpenApp(name)
	{
		FinishMotion();
		Owls.Effects.Play("appTap");

		const home = GetTop();
		const insets = home && home.name === "Home" && HasMotion() ? GetIconInsets(name) : null;

		if (!Push(name))
		{
			return;
		}

		if (!insets)
		{
			ShowTop();
			return;
		}

		PlayMotion(home.instance.element, GetTop().instance.element, [IconFrame(insets, 0), { opacity: 1, offset: 0.35 }, { clipPath: "inset(0px 0px 0px 0px round 0px)", transform: "scale(1)", opacity: 1 }], insets);
	}

	/// <summary>
	/// Return to the home screen from an app, shrinking what was on screen back into that app's icon (Muggle Phone only).
	/// </summary>
	/// <param name="appName">The app the screens were opened from (the one just above Home)</param>
	/// <param name="leaving">Element of the screen that was on screen</param>
	/// <returns>True when the motion plays; false when the caller should simply show the home screen</returns>
	function CloseInto(appName, leaving)
	{
		const home = GetTop();

		if (!HasMotion() || !home || home.name !== "Home")
		{
			return false;
		}

		FinishMotion();
		screenHost.replaceChildren(home.instance.element);
		home.instance.Refresh("ready");

		const insets = GetIconInsets(appName);

		if (!insets)
		{
			return false;
		}

		PlayMotion(home.instance.element, leaving, [{ clipPath: "inset(0px 0px 0px 0px round 0px)", transform: "scale(1)", opacity: 1 }, { opacity: 1, offset: 0.65 }, IconFrame(insets, 0)], insets);
		return true;
	}

	/// <summary>
	/// Let the home screen's icons fall into place, as the phone comes up (Muggle Phone only).
	/// </summary>
	function PlayFallIn()
	{
		const top = GetTop();
		const grid = top && top.name === "Home" && HasMotion() ? top.instance.element.querySelector(".home-grid") : null;

		if (!grid)
		{
			return;
		}

		// Taking the class off and reading the layout restarts the animation when the phone is opened twice in a row.
		clearTimeout(fallTimer);
		grid.classList.remove("is-falling");
		void grid.offsetWidth;
		grid.classList.add("is-falling");
		fallTimer = setTimeout(() => grid.classList.remove("is-falling"), fallInMs);
	}

	/// <summary>
	/// Remove the top screen and release its timers.
	/// </summary>
	function PopTop()
	{
		const top = stack.pop();

		if (top)
		{
			top.instance.Destroy();
		}
	}

	/// <summary>
	/// Create a screen and put it on top.
	/// </summary>
	/// <param name="name">Screen module name in Owls.Screens</param>
	/// <param name="params">Screen parameters</param>
	/// <returns>True if the screen could be created</returns>
	function Push(name, params = {})
	{
		const module = Owls.Screens[name];
		const instance = module ? module.Create(params) : null;

		if (!instance)
		{
			return false;
		}

		stack.push({ name, params, instance });
		return true;
	}

	/// <summary>
	/// Open a screen on top of the current one.
	/// </summary>
	/// <param name="name">Screen module name</param>
	/// <param name="params">Screen parameters</param>
	function Navigate(name, params = {})
	{
		if (Push(name, params))
		{
			ShowTop();
		}
	}

	/// <summary>
	/// Go back one screen; on the home screen, close the phone.
	/// </summary>
	function Back()
	{
		if (stack.length <= 1)
		{
			Close();
			return;
		}

		const leaving = GetTop();
		PopTop();

		// Leaving an app for the home screen shrinks it back into its icon.
		if (stack.length === 1 && CloseInto(leaving.name, leaving.instance.element))
		{
			return;
		}

		ShowTop();
		GetTop().instance.Refresh("ready");
	}

	/// <summary>
	/// Return to the home screen.
	/// </summary>
	function Home()
	{
		const appName = stack.length > 1 ? stack[1].name : "";
		const leaving = stack.length > 1 ? GetTop().instance.element : null;

		while (stack.length > 1)
		{
			PopTop();
		}

		if (stack.length === 0)
		{
			Push("Home");
		}

		if (leaving && CloseInto(appName, leaving))
		{
			return;
		}

		ShowTop();
		GetTop().instance.Refresh("ready");
	}

	/// <summary>
	/// Go back to an anchor screen (creating it above Home if it is not open) and open another screen on top.
	/// Used so that, for example, a chat opened from the contact picker returns to the chat list rather than the picker.
	/// </summary>
	/// <param name="anchor">Screen to unwind to (e.g. "Owls")</param>
	/// <param name="name">Screen to open on top of it</param>
	/// <param name="params">Its parameters</param>
	function ReplaceUntil(anchor, name, params)
	{
		const anchorIndex = stack.findIndex((entry) => entry.name === anchor);

		if (anchorIndex < 0)
		{
			while (stack.length > 1)
			{
				PopTop();
			}

			Push(anchor);
		}
		else
		{
			while (stack.length > anchorIndex + 1)
			{
				PopTop();
			}
		}

		Push(name, params);
		ShowTop();
	}

	/// <summary>
	/// Build every open screen again, keeping where the player was, e.g. after switching language.
	/// </summary>
	function Rebuild()
	{
		const entries = stack.splice(0, stack.length);

		for (const entry of entries)
		{
			entry.instance.Destroy();
		}

		// A screen whose subject is gone (a chat left meanwhile) cannot be rebuilt; the ones above it go with it.
		for (const entry of entries)
		{
			if (!Push(entry.name, entry.params))
			{
				break;
			}
		}

		if (stack.length === 0)
		{
			Push("Home");
		}

		ShowTop();
		GetTop().instance.Refresh("ready");
	}

	/// <summary>
	/// Open a chat, unless it is already on screen.
	/// </summary>
	/// <param name="chatId">Chat ID</param>
	function OpenChat(chatId)
	{
		const top = GetTop();

		if (top && top.name === "Chat" && top.params.chatId === chatId)
		{
			return;
		}

		ReplaceUntil("Owls", "Chat", { chatId });
	}

	/// <summary>
	/// Open the one-to-one chat with a contact: the existing one if there is one, a new one otherwise.
	/// </summary>
	/// <param name="contactId">Contact ID</param>
	/// <returns>Promise of { ok, error }</returns>
	async function OpenDirectChat(contactId)
	{
		const contact = Store.state.contacts.get(contactId);

		if (!contact)
		{
			return { ok: false, error: T("error.contactGone") };
		}

		const existing = Store.FindDirectChat(contact.number);

		if (existing)
		{
			OpenChat(existing.id);
			return { ok: true, error: "" };
		}

		const result = await Bridge.Request("chats.openDirect", { contactId });

		if (!result.ok)
		{
			return result;
		}

		Store.UpsertChat(result.data.chat);
		OpenChat(result.data.chat.id);
		return { ok: true, error: "" };
	}

	/// <summary>
	/// Open the one-to-one chat with an owl by its number (typed in, when the server allows dialling): the existing one if there is one, a new one otherwise.
	/// </summary>
	/// <param name="number">Owl number, spaces allowed</param>
	/// <returns>Promise of { ok, error }</returns>
	async function OpenNumberChat(number)
	{
		const existing = Store.FindDirectChat(String(number).replace(/[\s-]/g, ""));

		if (existing)
		{
			OpenChat(existing.id);
			return { ok: true, error: "" };
		}

		const result = await Bridge.Request("chats.openNumber", { number });

		if (!result.ok)
		{
			return result;
		}

		Store.UpsertChat(result.data.chat);
		OpenChat(result.data.chat.id);
		return { ok: true, error: "" };
	}

	/// <summary>
	/// The chat on screen, if the top screen is a chat.
	/// </summary>
	/// <returns>Chat ID, or 0</returns>
	function GetVisibleChatId()
	{
		const top = GetTop();
		return top && top.name === "Chat" ? top.params.chatId : 0;
	}

	// ========================
	// Calls
	// ========================

	/// <summary>
	/// Call an owl: open the call screen, which places the call. A player already in a call is shown that call instead.
	/// </summary>
	/// <param name="target">{ contactId } or { number }</param>
	/// <param name="anchor">Screen to return to after the call (e.g. "Calls"); "" returns to the screen it was started from</param>
	/// <returns>{ ok, error } where error says why the owl cannot be called</returns>
	function StartCall(target, anchor = "")
	{
		if (Store.state.call)
		{
			ShowCall();
			return { ok: true, error: "" };
		}

		const contact = target.contactId ? Store.state.contacts.get(target.contactId) : null;
		const number = contact ? contact.number : String(target.number || "");

		if (!number)
		{
			return { ok: false, error: T("error.contactGone") };
		}

		const check = Store.GetCallState(number);

		if (!check.canCall)
		{
			return { ok: false, error: check.reason };
		}

		DropCallScreens(true);

		if (anchor)
		{
			ReplaceUntil(anchor, "Call", { start: target });
		}
		else
		{
			Navigate("Call", { start: target });
		}

		return { ok: true, error: "" };
	}

	/// <summary>
	/// Put the screen of the player's current call on top, e.g. for a call that starts ringing.
	/// </summary>
	function ShowCall()
	{
		DropCallScreens(true);
		Push("Call");
		ShowTop();
	}

	/// <summary>
	/// Take call screens out of the stack.
	/// </summary>
	/// <param name="includeTop">Also remove one that is on screen; otherwise only those under other screens go</param>
	function DropCallScreens(includeTop)
	{
		for (let index = stack.length - (includeTop ? 1 : 2); index >= 1; --index)
		{
			if (stack[index].name === "Call")
			{
				stack.splice(index, 1)[0].instance.Destroy();
			}
		}
	}

	/// <summary>
	/// Close a call screen once its call is over: go back if it is on screen, otherwise just drop it from under the others.
	/// </summary>
	/// <param name="instance">The call screen's instance</param>
	function DismissCall(instance)
	{
		const index = stack.findIndex((entry) => entry.instance === instance);

		if (index < 0)
		{
			return;
		}

		if (index === stack.length - 1)
		{
			Back();
			return;
		}

		stack.splice(index, 1)[0].instance.Destroy();
	}

	/// <summary>
	/// Show the player's call in the status bar while its own screen is not on top: who is ringing, or how long they have been talking.
	/// Tapping it brings the call screen back.
	/// </summary>
	function UpdateCallIndicator()
	{
		const call = Store.state.call;
		const top = GetTop();
		const isShown = !!call && !(top && top.name === "Call");
		const isTicking = isShown && call.state === "active";

		callIndicator.hidden = !isShown;

		if (isShown)
		{
			callIndicatorText.textContent = isTicking ? Owls.Util.FormatDuration(Store.GetServerNow() - call.answeredAt) : call.direction === "in" ? T("call.incoming") : T("call.ringing");
		}

		if (isTicking && callIndicatorTimer === null)
		{
			callIndicatorTimer = setInterval(UpdateCallIndicator, 1000);
		}
		else if (!isTicking && callIndicatorTimer !== null)
		{
			clearInterval(callIndicatorTimer);
			callIndicatorTimer = null;
		}
	}

	/// <summary>
	/// Whether the player has a call ringing for them right now.
	/// </summary>
	/// <returns>True while an incoming call rings</returns>
	function IsRingingForMe()
	{
		const call = Store.state.call;
		return !!call && call.direction === "in" && call.state === "ringing";
	}

	/// <summary>
	/// Tell the player about a call they missed, silently: the ringing already made the noise.
	/// </summary>
	/// <param name="entry">Call log entry of the missed call</param>
	function AnnounceMissedCall(entry)
	{
		const contact = Store.state.contactsByNumber.get(entry.number);

		Notifications.Announce
		({
			title: Store.GetDisplayName(entry.number),
			body: T("calls.missedNotice"),
			avatar: () => Owls.Util.CreateAvatar(contact ? contact.name : "", Store.GetAvatarUrl(entry.number), entry.number, "is-small", contact ? "" : Owls.Icons.flame),
			onClick: () => OpenCalls(),
			silent: true,
		});
	}

	/// <summary>
	/// Open the call log, unless it is already on screen.
	/// </summary>
	function OpenCalls()
	{
		const top = GetTop();

		if (top && top.name === "Calls")
		{
			return;
		}

		while (stack.length > 1)
		{
			PopTop();
		}

		Navigate("Calls");
	}

	// ========================
	// Open & Close
	// ========================

	/// <summary>
	/// Ask the client script to close the phone and release input.
	/// </summary>
	function Close()
	{
		Bridge.Send("frantic-owls:close", null);
	}

	/// <summary>
	/// Whether the player can see the phone's screens: it is open and not behind the lock screen.
	/// </summary>
	/// <returns>True while open and unlocked</returns>
	function IsOpen()
	{
		return isOpen && !Owls.LockScreen.IsLocked();
	}

	/// <summary>
	/// The phone's screens came into view (the phone opened unlocked, or its lock was just opened): the top screen counts as looked at.
	/// </summary>
	function Reveal()
	{
		const top = GetTop();

		if (top && top.instance.OnOpened)
		{
			top.instance.OnOpened();
		}

		PlayFallIn();
	}

	/// <summary>
	/// Size the phone from the server's UI settings.
	/// </summary>
	/// <param name="ui">{ widthPx, heightPx, rightMarginPx }</param>
	function ApplyPhoneSize(ui)
	{
		if (!ui)
		{
			return;
		}

		const root = document.documentElement.style;
		root.setProperty("--phone-width", `${ui.widthPx / baseFontPx}rem`);
		root.setProperty("--phone-height", `${ui.heightPx / baseFontPx}rem`);
		root.setProperty("--phone-margin", `${ui.rightMarginPx / baseFontPx}rem`);
	}

	/// <summary>
	/// Switch the page to the theme in effect (the player's choice or the server default) and its colour scheme.
	/// The stylesheet only applies a scheme to the Muggle Phone theme.
	/// </summary>
	function ApplyTheme()
	{
		document.documentElement.dataset.theme = Store.GetTheme();
		document.documentElement.dataset.scheme = Store.GetColourScheme();
	}

	/// <summary>
	/// Show the moon in the status bar while the phone is kept quiet.
	/// </summary>
	function UpdateQuietIndicator()
	{
		const isQuiet = Store.IsQuiet();
		quietIndicator.hidden = !isQuiet;
		quietIndicator.title = !isQuiet ? "" : Store.state.settings.doNotDisturb ? T("quiet.indicatorManual") : T("quiet.indicatorActivity", { activity: Store.state.quiet.label || T("quiet.activityFallback") });
	}

	// ========================
	// Server Items
	// ========================

	Bridge.On("state:reset", (data) =>
	{
		const isOtherOwl = Store.state.me.number !== (data.me && data.me.number);

		Store.Reset(data);
		Bridge.SetTimeout(Store.state.config.requestTimeoutMs);
		ApplyPhoneSize(Store.state.config.ui);

		if (isOtherOwl)
		{
			Home();
		}
	});

	Bridge.On("lang:chunk", (data) => Owls.Lang.ApplyChunk(data));

	Bridge.On("lang:ready", (data) =>
	{
		Owls.Lang.Finish(data);
		Owls.Util.SetLocale(Owls.Lang.GetId());
		UpdateQuietIndicator();
		Rebuild();
		Owls.LockScreen.Refresh("settings");
	});

	Bridge.On("owl:retired", (data) => Store.SetRetired(String(data.number)));
	Bridge.On("quiet:update", (data) => Store.SetQuiet(data));
	Bridge.On("profiles:chunk", (data) => Store.ApplyProfilesChunk(data));
	Bridge.On("profile:update", (data) => Store.SetProfile(String(data.number), String(data.avatarUrl || "")));
	Bridge.On("settings:update", (data) => Store.SetSettings(data.settings || {}));
	Bridge.On("senders:update", (data) => Store.SetSenders(data.senders || []));
	Bridge.On("message:landed", (data) => Store.NotifyChanged(`history:${data.chatId}`));
	Bridge.On("contacts:chunk", (data) => Store.ApplyContactsChunk(data));
	Bridge.On("chats:chunk", (data) => Store.ApplyChatsChunk(data));
	Bridge.On("state:ready", () => Store.SetReady());
	Bridge.On("contact:upsert", (data) => Store.UpsertContact(data.contact));
	Bridge.On("chat:upsert", (data) => Store.UpsertChat(data.chat));
	Bridge.On("chat:update", (data) => Store.UpsertChat(data.chat));
	Bridge.On("chat:read", (data) => Store.SetRead(data.chatId, String(data.number), data.messageId));
	Bridge.On("chat:typing", (data) => Store.SetTyping(data.chatId, String(data.number), data.durationMs));
	Bridge.On("message:unsent", (data) => Store.MarkUnsent(data.chatId, data.messageId, data.unsentAt));
	Bridge.On("parcel:update", (data) => Store.SetParcel(Number(data.chatId) || 0, Number(data.messageId), data.parcel || null));
	Bridge.On("poll:votes", (data) => Store.SetPollVotes(data.chatId, data.messageId, data.votes));

	Bridge.On("chat:removed", (data) =>
	{
		const chat = Store.state.chats.get(data.chatId);
		const title = chat ? Store.GetChatTitle(chat) : String(data.title || T("chat.removedFallbackTitle"));

		// Close anything showing the chat first, so no screen is left drawing a chat that is gone.
		if (stack.some((entry) => entry.params.chatId === data.chatId))
		{
			Home();
		}

		Store.RemoveChat(data.chatId);
		Notifications.Announce
		({
			title: T("app.name"),
			body: T("chat.removedNotice", { title }),
			avatar: () => Owls.Util.CreateAvatar("", "", "notify", "is-small", Owls.Icons.group),
			silent: true,
		});
	});

	Bridge.On("state:clear", () =>
	{
		Store.Clear();
		Home();
	});

	Bridge.On("message:new", (data) =>
	{
		const chat = Store.UpsertChat(data.chat);
		const message = data.message;
		Store.ClearTyping(chat.id, message.sender);

		const isNew = Store.AddMessage(message);
		const isReading = IsOpen() && GetVisibleChatId() === chat.id;

		// The player is reading this very chat (the chat screen marks it read): no pop-up, just the soft sound of an owl landing in it.
		if (isNew && isReading && !Store.IsNote(message) && !Store.IsMuted(chat))
		{
			Owls.Effects.Play("messageReceived");
		}

		// Notes (someone leaving) update the chat silently: no sound, no pop-up, nothing unread.
		if (!isNew || isReading || Store.IsNote(message))
		{
			// Nothing to announce: a duplicate, or the player is reading this very chat.
			Notifications.ReleaseIfIdle();
			return;
		}

		Store.SetUnread(chat.id, (chat.unread || 0) + 1);

		// A muted chat still counts the owl as unread, but makes no sound and shows nothing.
		if (Store.IsMuted(chat))
		{
			Notifications.ReleaseIfIdle();
			return;
		}

		const sender = Store.GetDisplayName(message.sender);

		Notifications.Announce
		({
			title: chat.kind === "group" ? `${sender} · ${Store.GetChatTitle(chat)}` : sender,
			body: Store.GetMessageText(message),
			avatar: () => Store.CreateChatAvatar(chat, "is-small"),
			onClick: () => OpenChat(chat.id),
		});
	});

	Bridge.On("notify", (data) =>
	{
		// Server notifications name their text by key, so each player reads it in their own language.
		Notifications.Announce
		({
			title: data.titleKey ? T(String(data.titleKey), data.params || {}) : String(data.title || T("app.name")),
			body: data.bodyKey ? T(String(data.bodyKey), data.params || {}) : String(data.body || ""),
			avatar: () => Owls.Util.CreateAvatar("", "", "notify", "is-small", Owls.Icons.owl),
			onClick: data.kind === "inform" && data.contactId ? () => Navigate("ContactDetails", { contactId: data.contactId }) : null,
			silent: data.kind === "error",
		});
	});

	Bridge.On("inform:requests", (data) => Store.SetInformRequests(Array.isArray(data.requests) ? data.requests : []));

	Bridge.On("inform:request", (data) =>
	{
		const request = data.request;

		if (!request || !request.id)
		{
			Notifications.ReleaseIfIdle();
			return;
		}

		Store.AddInformRequest(request);

		Notifications.Announce
		({
			title: String(request.name || T("inform.someWizard")),
			body: T("inform.requestNotice"),
			avatar: () => Owls.Util.CreateAvatar(String(request.name || ""), String(request.avatarUrl || ""), String(request.name || ""), "is-small"),
			onClick: () => Navigate("Inform"),
		});
	});

	Bridge.On("location:route", (data) => Store.SetShownLocation(Number(data.chatId) || 0, Number(data.messageId) || 0));

	Bridge.On("location:clear", (data) =>
	{
		// A clear about a location that has since been replaced leaves the new one alone.
		if (Store.IsLocationShown(Number(data.chatId) || 0, Number(data.messageId) || 0))
		{
			Store.SetShownLocation(0, 0);
		}

		if (data.reason !== "arrived")
		{
			return;
		}

		Notifications.Announce
		({
			title: T("app.name"),
			body: T("location.arrived"),
			avatar: () => Owls.Util.CreateAvatar("", "", "notify", "is-small", Owls.Icons.map),
		});
	});

	Bridge.On("calls:chunk", (data) => Store.ApplyCallsChunk(data));

	Bridge.On("call:current", (data) =>
	{
		Store.SetCall(data.call || null);

		if (IsRingingForMe())
		{
			Notifications.StartRinging(Store.GetDisplayName(Store.state.call.number));
		}
	});

	Bridge.On("call:incoming", (data) =>
	{
		if (!data.call || !data.call.id)
		{
			Notifications.ReleaseIfIdle();
			return;
		}

		Store.SetCall(data.call);
		Notifications.StartRinging(Store.GetDisplayName(data.call.number));

		// Like a phone, the call takes over the screen, lock and all; a closed phone shows it once opened.
		if (isOpen)
		{
			ShowCall();
			Owls.LockScreen.Unlock(false);
		}
	});

	Bridge.On("call:update", (data) => Store.SetCall(data.call));

	Bridge.On("call:ended", (data) =>
	{
		Store.EndCall(data);
		Store.AddCallEntry(data.entry);

		if (data.entry && data.entry.isNew)
		{
			AnnounceMissedCall(data.entry);
			return;
		}

		Notifications.ReleaseIfIdle();
	});

	// A call that never rang here (this owl was on another call) still shows up as missed.
	Bridge.On("call:logged", (data) =>
	{
		Store.AddCallEntry(data.entry);

		if (data.entry && data.entry.isNew)
		{
			AnnounceMissedCall(data.entry);
			return;
		}

		Notifications.ReleaseIfIdle();
	});

	// ========================
	// Page Lifecycle
	// ========================

	Bridge.On("ui:opened", () =>
	{
		// Taken out again before it had finished going away: it still locked in between.
		if (closeTimer !== null)
		{
			Owls.LockScreen.OnClosed();
		}

		clearTimeout(closeTimer);
		closeTimer = null;
		phone.classList.remove("is-closing");

		isOpen = true;
		phone.hidden = false;
		Notifications.SetPhoneOpen(true);

		// Opening the phone on a ringing call goes straight to it.
		if (IsRingingForMe() && GetTop().name !== "Call")
		{
			ShowCall();
		}

		// Behind the lock nothing counts as looked at yet; the lock reveals the phone once it is opened.
		if (!Owls.LockScreen.OnOpened())
		{
			Reveal();
		}
	});

	// Input goes back to the game at once; the phone slides away, and only then does the page let the client hide the view.
	Bridge.On("ui:closed", () =>
	{
		// The click of the screen locking, as the phone goes away; Frantic_Phone played it at the same moment.
		if (Owls.LockScreen.IsEnabled() && !Owls.LockScreen.IsLocked())
		{
			Owls.Effects.Play("lock");
		}

		isOpen = false;
		Notifications.SetPhoneOpen(false);
		phone.classList.add("is-closing");

		clearTimeout(closeTimer);
		closeTimer = setTimeout(() =>
		{
			closeTimer = null;
			phone.hidden = true;
			phone.classList.remove("is-closing");
			Owls.LockScreen.OnClosed();
			Notifications.ReleaseIfIdle();
		}, closeAnimationMs);
	});

	Bridge.On("ui:layout", (data) => Owls.LayoutEditor.Apply(data));

	Store.Subscribe((reason) =>
	{
		if (reason === "settings" || reason === "reset" || reason === "ready")
		{
			ApplyTheme();
			UpdateWallpaper();
		}

		if (reason === "settings" || reason === "quiet" || reason === "reset" || reason === "ready")
		{
			UpdateQuietIndicator();
		}

		if (reason === "settings")
		{
			Owls.Voice.ApplyVolume();
		}

		if (reason === "call" || reason === "reset")
		{
			if (!IsRingingForMe())
			{
				Notifications.StopRinging();
			}

			// Voice runs while a call is answered, and the view stays on screen for it even with the phone closed.
			const call = Store.state.call;
			const isTalking = !!call && call.state === "active";

			if (isTalking)
			{
				Owls.Voice.Start(call.id, !!call.isMuted);
			}
			else
			{
				Owls.Voice.Stop();
			}

			Notifications.SetCallHold(isTalking);

			// A call screen buried under others never hears its call end; it simply goes.
			if (!Store.state.call)
			{
				DropCallScreens(false);
			}

			UpdateCallIndicator();
		}

		Owls.LockScreen.Refresh(reason);

		const top = GetTop();

		if (top)
		{
			top.instance.Refresh(reason);
		}
	});

	Owls.LockScreen.SetOnUnlocked(Reveal);

	window.addEventListener("keydown", (event) =>
	{
		if (event.key !== "Escape" || !isOpen)
		{
			return;
		}

		event.preventDefault();

		if (Owls.LayoutEditor.IsEditing())
		{
			Owls.LayoutEditor.Cancel();
			return;
		}

		// On the lock screen Escape puts the phone away rather than going back behind it.
		if (Owls.LockScreen.IsLocked())
		{
			Close();
			return;
		}

		Back();
	});

	document.getElementById("phone-close").innerHTML = Owls.Icons.close;
	document.getElementById("status-call-icon").innerHTML = Owls.Icons.flame;
	callIndicator.addEventListener("click", () =>
	{
		ShowCall();
		Owls.LockScreen.Unlock(false);
	});
	quietIndicator.innerHTML = Owls.Icons.moon;
	document.getElementById("phone-close").addEventListener("click", Close);
	document.getElementById("home-bar").addEventListener("click", Home);

	ApplyTheme();
	Home();
	Bridge.Send("frantic-owls:ready", null);

	return { Navigate, OpenApp, Back, Home, ReplaceUntil, Rebuild, OpenChat, OpenDirectChat, OpenNumberChat, GetVisibleChatId, StartCall, ShowCall, DismissCall, Close, IsOpen };
})();
