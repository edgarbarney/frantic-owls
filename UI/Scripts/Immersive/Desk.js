// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Desk
// ========================

/// <summary>
/// Immersive mode's letter desk: a full-screen writing desk in the middle of the screen, over a dimmed game.
///
/// <para>
/// NOTE: The client script sizes the view to the whole screen while the desk is open and to a strip at the top while it is closed,
/// so notices of arriving owls can drop in without the game paying for a full-screen page. It tells the page which with "ui:layout".
/// The page reports through "frantic-owls:overlay" whether it still needs the view on screen while closed (a notice, or the closing animation).
/// </para>
///
/// </summary>
Owls.Desk = (() =>
{
	const Bridge = Owls.Bridge;
	const Store = Owls.MailStore;
	const T = Owls.Lang.T;

	/// <summary>
	/// Length of the desk's closing animation; must match .desk.is-closing in Immersive.css.
	/// </summary>
	const closeAnimationMs = 220;

	/// <summary>
	/// Time a notice takes to slide away; must match .notice in Immersive.css.
	/// </summary>
	const noticeLeaveMs = 300;

	/// <summary>
	/// How long an error notice stays, at the least.
	/// </summary>
	const errorNoticeMs = 4000;

	/// <summary>
	/// The screens that show the tabs along the top of the desk, the official tab among them.
	/// </summary>
	const tabScreens = ["Letters", "Correspondents", "Official"];

	const desk = document.getElementById("desk");
	const view = document.getElementById("desk-view");
	const postLabel = document.getElementById("desk-post");
	const notice = document.getElementById("notice");
	const noticeTitle = document.getElementById("notice-title");
	const noticeBody = document.getElementById("notice-body");
	const dispatch = document.getElementById("dispatch");
	const postJson = document.getElementById("post-json");
	const postJsonField = document.getElementById("post-json-field");
	const postJsonStatus = document.getElementById("post-json-status");
	const sound = document.getElementById("owl-sound");

	let isOpen = false;
	let isClosing = false;
	let isNoticeShowing = false;
	let noticeTimer = null;
	let closeTimer = null;
	let hasAnnouncedUnread = false;

	/// <summary>
	/// The screen on the desk: { name, params, instance }.
	/// </summary>
	let current = null;

	// ========================
	// Screens
	// ========================

	/// <summary>
	/// Put a screen on the desk, replacing the one there.
	/// </summary>
	/// <param name="name">Screen name in Owls.DeskScreens</param>
	/// <param name="params">Screen parameters</param>
	function Show(name, params = {})
	{
		if (current && current.instance.Destroy)
		{
			current.instance.Destroy();
		}

		const instance = Owls.DeskScreens[name].Create(api, params);
		current = { name, params, instance };
		view.replaceChildren(instance.element);
		view.dataset.screen = name;
	}

	/// <summary>
	/// Build the current screen again, e.g. after the language changed.
	/// </summary>
	function Rebuild()
	{
		if (current)
		{
			Show(current.name, current.params);
		}
	}

	/// <summary>
	/// Show the list of letters.
	/// </summary>
	/// <param name="params">{ box } (optional)</param>
	function ShowLetters(params = {})
	{
		Show("Letters", params);
	}

	/// <summary>
	/// Show the player's correspondents.
	/// </summary>
	function ShowCorrespondents()
	{
		Show("Correspondents");
	}

	/// <summary>
	/// Show the senders an official letter can be written as, for those allowed to.
	/// </summary>
	function ShowOfficial()
	{
		Show(Store.state.me.canPostOfficial ? "Official" : "Letters");
	}

	/// <summary>
	/// Open a letter to read.
	/// </summary>
	/// <param name="letter">Listed letter</param>
	function Read(letter)
	{
		Show("Reader", { letter });
	}

	/// <summary>
	/// Start (or carry on) writing a letter.
	/// </summary>
	/// <param name="params">{ replyTo } with the letter being answered, { to } with a correspondent, or { official } with the sender of an official letter (all optional)</param>
	function Compose(params = {})
	{
		// Official letters are not tied to owl posts.
		if (!params.official && !Store.CanWrite())
		{
			ShowError(T("error.mail.writeAtPost"));
			return;
		}

		Show("Compose", params);
	}

	/// <summary>
	/// A line telling the player what they can do where they stand, when the server ties letters to owl posts.
	/// </summary>
	/// <returns>Hint text, or "" when posts make no difference</returns>
	function GetPlaceHint()
	{
		const config = Store.state.config;

		if (!Store.UsesPosts())
		{
			return "";
		}

		if (Store.state.post)
		{
			return T("mail.place.atPost", { post: Store.state.post.label });
		}

		if (config.writeMode === "postonly" && config.readMode === "postonly")
		{
			return T("mail.place.awayAll");
		}

		if (config.writeMode === "postonly")
		{
			return T(config.readMode === "postonly_freeunread" ? "mail.place.awayWriteUnread" : "mail.place.awayWrite");
		}

		return T(config.readMode === "postonly_freeunread" ? "mail.place.awayReadUnread" : "mail.place.awayRead");
	}

	/// <summary>
	/// Show which owl post the desk was opened at, if posts matter on this server.
	/// </summary>
	function UpdatePostLabel()
	{
		const post = Store.state.post;
		postLabel.hidden = !Store.UsesPosts();
		postLabel.textContent = post ? T("mail.place.badge", { post: post.label }) : T("mail.place.badgeAway");
		postLabel.classList.toggle("is-away", !post);
	}

	// ========================
	// Notices & Sounds
	// ========================

	/// <summary>
	/// Whether the player wants to be disturbed right now.
	/// </summary>
	/// <returns>True when notices and sounds may play</returns>
	function MayDisturb()
	{
		const settings = Store.state.settings;
		return !settings.doNotDisturb && !(Store.state.quiet.active && settings.quietDuringActivities);
	}

	/// <summary>
	/// Tell the client script whether the view must stay on screen while the desk is closed.
	/// </summary>
	function ReportOverlay()
	{
		if (!isOpen && !isClosing)
		{
			Bridge.Send("frantic-owls:overlay", { active: isNoticeShowing });
		}
	}

	/// <summary>
	/// Drop a notice in at the top of the screen.
	/// </summary>
	/// <param name="title">First line</param>
	/// <param name="body">Second line</param>
	/// <param name="isError">True for a problem, which shows even with notices off and stays a little longer</param>
	function ShowNotice(title, body, isError = false)
	{
		if (!isError && (!Store.state.settings.popups || !MayDisturb()))
		{
			ReportOverlay();
			return;
		}

		noticeTitle.textContent = title;
		noticeBody.textContent = body;
		notice.classList.toggle("is-error", isError);
		notice.hidden = false;
		requestAnimationFrame(() => notice.classList.add("is-showing"));
		isNoticeShowing = true;
		ReportOverlay();

		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(HideNotice, Math.max(isError ? errorNoticeMs : 0, Number(Store.state.config.toastDurationMs) || 3000));
	}

	/// <summary>
	/// Slide the notice away, then let the view go if the desk is closed.
	/// </summary>
	function HideNotice()
	{
		clearTimeout(noticeTimer);
		notice.classList.remove("is-showing");
		noticeTimer = setTimeout(() =>
		{
			notice.hidden = true;
			isNoticeShowing = false;
			ReportOverlay();
		}, noticeLeaveMs);
	}

	/// <summary>
	/// Show a problem to the player.
	/// </summary>
	/// <param name="text">What went wrong, in their language</param>
	function ShowError(text)
	{
		ShowNotice(T("mail.notice.problem"), text, true);
	}

	/// <summary>
	/// Play the sound of an arriving owl, honouring the player's settings and the server's sound mode.
	/// </summary>
	/// <param name="previewId">Sound ID to try out from Settings: plays even with sounds off; omitted for a real arrival</param>
	function PlaySound(previewId)
	{
		const settings = Store.state.settings;
		const config = Store.state.config;
		const isPreview = typeof previewId === "string";

		if (!isPreview && (!settings.notificationSound || !MayDisturb()))
		{
			return;
		}

		if (config.soundMode === "wwise")
		{
			Bridge.Send("frantic-owls:sound", null);
			return;
		}

		if (config.soundMode !== "file")
		{
			return;
		}

		const sounds = Array.isArray(config.sounds) ? config.sounds : [];
		const wanted = isPreview ? previewId : settings.sound;
		const chosen = sounds.find((entry) => entry.id === wanted) || sounds.find((entry) => entry.id === config.defaultSound) || sounds[0];

		if (!chosen)
		{
			return;
		}

		if (!sound.src.endsWith(chosen.file))
		{
			sound.src = chosen.file;
		}

		sound.volume = Math.min(1, Math.max(0, Number(settings.notificationVolume)));
		sound.currentTime = 0;

		// play() rejects when the browser refuses playback; a missed sound is not worth surfacing.
		sound.play().catch(() => {});
	}

	/// <summary>
	/// The way to open the desk, for notices shown while it is closed.
	/// </summary>
	/// <returns>Hint text</returns>
	function GetOpenHint()
	{
		return T("mail.notice.openHint", { command: `/${Store.state.config.command || "owl"}` });
	}

	/// <summary>
	/// Tell the player that a letter arrived.
	/// </summary>
	function OnArrival()
	{
		Store.NoteArrival();
		PlaySound();

		if (!isOpen)
		{
			ShowNotice(T("mail.notice.arrived"), GetOpenHint());
		}
		else if (!current || current.name !== "Letters")
		{
			ShowNotice(T("mail.notice.arrived"), T("mail.notice.arrivedOpen"));
		}
	}

	/// <summary>
	/// Show the card that says a letter was sent, with any recipient it could not reach.
	/// </summary>
	/// <param name="sentCount">Copies sent</param>
	/// <param name="failed">[{ name, error }]</param>
	/// <param name="everyone">True for an official letter to everyone</param>
	function ShowDispatch(sentCount, failed, everyone = false)
	{
		const failures = document.getElementById("dispatch-failures");
		document.getElementById("dispatch-title").textContent = T("mail.dispatch.title");
		document.getElementById("dispatch-body").textContent = everyone ? T("mail.dispatch.everyone") : T(Store.state.config.flightEnabled ? "mail.dispatch.flying" : "mail.dispatch.body", { count: sentCount });
		failures.replaceChildren(...failed.map((failure) => Owls.Util.Element("li", { text: T("mail.dispatch.failed", { name: failure.name, error: failure.error }) })));
		failures.hidden = failed.length === 0;
		dispatch.hidden = false;
		requestAnimationFrame(() => dispatch.classList.add("is-showing"));
		document.getElementById("dispatch-close").focus();
	}

	/// <summary>
	/// Put the dispatch card away.
	/// </summary>
	function HideDispatch()
	{
		dispatch.classList.remove("is-showing");
		dispatch.hidden = true;
	}

	// ========================
	// Owl Post Definition
	// ========================

	/// <summary>
	/// Show the owl post entry /owl_posthere made, ready to copy into the configuration.
	/// </summary>
	/// <param name="data">{ id, json, isTaken }</param>
	function ShowPostDefinition(data)
	{
		const command = Store.state.config.command || "owl";
		const warning = document.getElementById("post-json-warning");
		document.getElementById("post-json-help").textContent = T("admin.postJson.help", { command });
		warning.textContent = T("command.postHereTaken", { id: data.id });
		warning.hidden = data.isTaken !== true;
		postJsonField.value = String(data.json || "");
		postJsonStatus.textContent = "";
		postJson.hidden = false;
		requestAnimationFrame(() => postJson.classList.add("is-showing"));
		document.getElementById("post-json-copy").focus();
	}

	/// <summary>
	/// Put the owl post entry away.
	/// </summary>
	function HidePostDefinition()
	{
		postJson.classList.remove("is-showing");
		postJson.hidden = true;
	}

	/// <summary>
	/// Copy the owl post entry to the clipboard.
	///
	/// <para>
	/// NOTE: The game's browser may refuse the clipboard API, so the selected text is copied the old way when it does.
	/// If both fail the text is left selected for the admin to copy themselves.
	/// </para>
	///
	/// </summary>
	async function CopyPostDefinition()
	{
		let isCopied = false;

		// writeText rejects when the page may not use the clipboard; execCommand is the fallback for that.
		try
		{
			await navigator.clipboard.writeText(postJsonField.value);
			isCopied = true;
		}
		catch (error)
		{
			postJsonField.focus();
			postJsonField.select();

			// execCommand throws in some browsers rather than returning false.
			try
			{
				isCopied = document.execCommand("copy");
			}
			catch (copyError)
			{
				isCopied = false;
			}
		}

		postJsonStatus.textContent = T(isCopied ? "admin.postJson.copied" : "admin.postJson.copyFailed");
	}

	// ========================
	// Open & Close
	// ========================

	/// <summary>
	/// The desk was opened by the client script.
	/// </summary>
	function OnOpened()
	{
		clearTimeout(closeTimer);
		isOpen = true;
		isClosing = false;
		desk.hidden = false;
		desk.classList.remove("is-closing");
		requestAnimationFrame(() => desk.classList.add("is-open"));
		UpdatePostLabel();

		// Coming back to the desk starts at the letters, freshly listed, unless a letter was being written.
		if (!current || current.name !== "Compose")
		{
			ShowLetters({});
		}

		RefreshOfficial();
	}

	/// <summary>
	/// Ask the server again whether the player may write official letters, since staff rights can change while the character stays loaded.
	/// </summary>
	async function RefreshOfficial()
	{
		const result = await Bridge.Request("me.refresh", {});

		if (result.ok)
		{
			Store.SetCanPostOfficial(result.data.canPostOfficial === true);
		}
	}

	/// <summary>
	/// The desk was closed by the client script: play the closing animation, then give the view back.
	/// </summary>
	function OnClosed()
	{
		if (!isOpen)
		{
			return;
		}

		isOpen = false;
		isClosing = true;
		HideDispatch();
		HidePostDefinition();
		desk.classList.remove("is-open");
		desk.classList.add("is-closing");
		clearTimeout(closeTimer);
		closeTimer = setTimeout(() =>
		{
			isClosing = false;
			desk.hidden = true;
			desk.classList.remove("is-closing");
			Bridge.Send("frantic-owls:overlay", { active: isNoticeShowing });
		}, closeAnimationMs);
	}

	/// <summary>
	/// Ask the client script to close the desk.
	/// </summary>
	function Close()
	{
		Bridge.Send("frantic-owls:close", null);
	}

	/// <summary>
	/// Take the client script's layout: the scale for this screen, and whether the view is the whole screen or the notice strip.
	/// </summary>
	/// <param name="layout">{ mode: "desk" | "notice", baseScale }</param>
	function OnLayout(layout)
	{
		const scale = Math.max(0.3, Number(layout.baseScale) || 1);
		document.documentElement.style.setProperty("--ui-scale", String(scale));
		document.body.dataset.layout = layout.mode === "notice" ? "notice" : "desk";
	}

	// ========================
	// Wiring
	// ========================

	const api = { ShowLetters, ShowCorrespondents, ShowOfficial, Read, Compose, ShowError, ShowNotice, ShowDispatch, PlaySound, GetPlaceHint, Close };

	document.getElementById("desk-close").addEventListener("click", Close);
	document.getElementById("desk-settings").addEventListener("click", () => Show("Settings"));
	document.getElementById("dispatch-close").addEventListener("click", HideDispatch);
	document.getElementById("post-json-close").addEventListener("click", HidePostDefinition);
	document.getElementById("post-json-copy").addEventListener("click", CopyPostDefinition);

	document.addEventListener("keydown", (event) =>
	{
		if (event.key !== "Escape" || !isOpen)
		{
			return;
		}

		event.preventDefault();

		if (!postJson.hidden)
		{
			HidePostDefinition();
			return;
		}

		if (!dispatch.hidden)
		{
			HideDispatch();
			return;
		}

		Close();
	});

	Store.Subscribe((reason) =>
	{
		if (reason === "post" || reason === "letters" || reason === "reset")
		{
			UpdatePostLabel();
		}

		// The official tab comes and goes with the permission, so the screens that show the tabs are built again.
		if (reason === "me" && current)
		{
			if (current.name === "Official" && !Store.state.me.canPostOfficial)
			{
				ShowLetters({});
			}
			else if (tabScreens.includes(current.name))
			{
				Rebuild();
			}

			return;
		}

		if (current && current.instance.OnStore)
		{
			current.instance.OnStore(reason);
		}
	});

	Bridge.On("lang:chunk", (data) => Owls.Lang.ApplyChunk(data));

	Bridge.On("lang:ready", (data) =>
	{
		Owls.Lang.Finish(data);
		Owls.Util.SetLocale(Owls.Lang.GetId());
		UpdatePostLabel();
		Rebuild();
	});

	Bridge.On("state:reset", (data) =>
	{
		Store.Reset(data);
		Owls.MailSearch.Clear();
		hasAnnouncedUnread = false;
	});

	Bridge.On("state:ready", () =>
	{
		Store.SetReady();

		// Letters that arrived while the character was away are mentioned once, when the owl post first comes up.
		if (!hasAnnouncedUnread && Store.state.unread > 0 && !isOpen)
		{
			hasAnnouncedUnread = true;
			ShowNotice(T("mail.notice.waiting", { count: Store.state.unread }), GetOpenHint());
		}
	});

	Bridge.On("state:clear", () =>
	{
		Store.Clear();
		current = null;
		view.replaceChildren();
	});

	Bridge.On("contacts:chunk", (data) => Store.ApplyContactsChunk(data));
	Bridge.On("contact:upsert", (data) => Store.SaveContact(data.contact));
	Bridge.On("settings:update", (data) => Store.SetSettings(data.settings));
	Bridge.On("quiet:update", (data) => Store.SetQuiet(data));
	Bridge.On("parcel:update", (data) => Store.SetParcel(Number(data.messageId), data.parcel || null));
	Bridge.On("mail:arrived", OnArrival);
	Bridge.On("ui:open", (data) => Store.SetPost(data.post || null));
	Bridge.On("admin:postDefinition", ShowPostDefinition);
	Bridge.On("ui:opened", OnOpened);
	Bridge.On("ui:closed", OnClosed);
	Bridge.On("ui:layout", OnLayout);

	Bridge.On("notify", (data) =>
	{
		const title = data.titleKey ? T(data.titleKey, data.params || {}) : String(data.title || "");
		const body = data.bodyKey ? T(data.bodyKey, data.params || {}) : String(data.body || "");
		ShowNotice(title, body, data.kind === "error");
	});

	Owls.Lang.ApplyStatic();
	Bridge.Send("frantic-owls:ready", null);

	return api;
})();
