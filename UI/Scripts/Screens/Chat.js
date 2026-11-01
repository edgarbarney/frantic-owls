// FranticDreamer 2026
"use strict";

// ========================
// Chat Screen
// ========================

/// <summary>
/// One conversation: the contact's picture and name on top, the history in the middle, and the composer at the bottom.
/// Tapping an owl selects it and offers Reply, Forward, Pin, Delete (from this phone) and, for your own recent owls, Unsend.
/// The search icon looks through the whole chat on the server; bulk owls also take polls. Unsent text is kept as the chat's draft.
///
/// <para>
/// NOTE: Sent owls appear immediately as pending bubbles and are swapped for the stored message when the server replies.
/// If no reply arrives within the request timeout, the bubble turns red and a tap resends it.
/// This keeps typing responsive on a laggy connection without ever pretending an undelivered owl was delivered.
/// </para>
///
/// </summary>
Owls.Screens.Chat = (() =>
{
	const { Element } = Owls.Util;
	const Widgets = Owls.Widgets;
	const T = Owls.Lang.T;

	/// <summary>
	/// Distance from the bottom, in pixels, within which the view keeps following new messages.
	/// </summary>
	const stickToBottomPx = 80;

	/// <summary>
	/// Show the character counter once this share of the length limit is used.
	/// </summary>
	const counterThreshold = 0.8;

	/// <summary>
	/// Least time between two "typing" pings. The server shows a typist for 5 seconds after each one.
	/// </summary>
	const typingPingMs = 2500;

	/// <summary>
	/// How long a destructive action waits for its confirming second tap.
	/// </summary>
	const confirmWindowMs = 4000;

	/// <summary>
	/// Shortest search the server takes, and how long typing must pause before a search is sent.
	/// </summary>
	const minSearchLength = 2;
	const searchDelayMs = 350;

	/// <summary>
	/// Most pages of older owls loaded to reach an owl jumped to (from a quote, the pinned bar or a search result).
	/// </summary>
	const maxJumpPages = 25;

	/// <summary>
	/// Characters of context kept before a search match in a result's snippet.
	/// </summary>
	const snippetLead = 24;

	/// <summary>
	/// Create the screen.
	/// </summary>
	/// <param name="params">{ chatId }</param>
	/// <returns>Screen instance, or null if the chat is unknown</returns>
	function Create(params)
	{
		const chatId = params.chatId;
		const config = Owls.Store.state.config;
		const maxLength = config.maxMessageLength || 500;

		if (!Owls.Store.state.chats.has(chatId))
		{
			return null;
		}

		let isLoadingOlder = false;
		let lastReadSent = 0;
		let isFirstRender = true;
		let landingTimer = null;
		let lastTypingPing = 0;
		let selectedId = 0;
		let replyTo = null;
		let pendingConfirm = "";
		let confirmTimer = null;
		let searchTimer = null;
		let searchSerial = 0;
		let isJumping = false;

		// ========================
		// Header
		// ========================

		const headerAvatar = Element("span");
		const headerTitle = Element("span", { className: "screen-title" });
		const headerSub = Element("span", { className: "chat-header-sub" });
		const headerButton = Element("button", { className: "chat-header-button" }, [headerAvatar, Element("span", { className: "chat-header-text" }, [headerTitle, headerSub])]);
		const searchButton = Widgets.IconButton(Owls.Icons.search, T("chat.search"), () => ToggleSearch());
		const callButton = Widgets.IconButton(Owls.Icons.flame, T("call.start"), () => Call());
		const pinChatButton = Widgets.IconButton(Owls.Icons.thumbtack, T("chat.pinChat"), () => PinChat());
		const muteButton = Widgets.IconButton(Owls.Icons.bell, T("chat.notifications"), () => ShowBar(muteBar));
		const blockButton = Widgets.IconButton(Owls.Icons.ban, T("chat.blockOwl"), () => ShowBar(blockBar));
		const leaveButton = Widgets.IconButton(Owls.Icons.leave, T("chat.leaveBulk"), () => ShowBar(leaveBar));
		const header = Element("div", { className: "screen-header" }, [Widgets.IconButton(Owls.Icons.back, T("common.back"), () => Owls.App.Back()), headerButton, searchButton, callButton, pinChatButton, muteButton, blockButton, leaveButton]);
		const headerError = Element("div", { className: "form-error chat-error" });

		// ========================
		// Search
		// ========================

		const searchInput = Element("input", { className: "text-input", attributes: { type: "text", maxlength: 64, placeholder: T("chat.searchPlaceholder") } });
		const searchRow = Element("div", { className: "search-row" }, [searchInput]);
		const searchResults = Element("div", { className: "screen-body chat-search-results" });
		searchRow.hidden = true;
		searchResults.hidden = true;

		// ========================
		// Pinned Owl
		// ========================

		const pinnedIcon = Element("span", { className: "pinned-icon" });
		pinnedIcon.innerHTML = Owls.Icons.thumbtack;
		const pinnedText = Element("span", { className: "pinned-text" });
		const pinnedJump = Element("button", { className: "pinned-jump" }, [pinnedIcon, pinnedText]);
		const unpinButton = Widgets.IconButton(Owls.Icons.close, T("chat.unpin"), () => PinMessage(0));
		const pinnedBar = Element("div", { className: "pinned-bar" }, [pinnedJump, unpinButton]);

		// ========================
		// Mute Bar
		// ========================

		const muteError = Element("span", { className: "form-error" });
		const muteStatus = Element("span", { className: "leave-text" });
		const muteChoices =
		[
			{ label: T("chat.mute1h"), minutes: 60 },
			{ label: T("chat.mute8h"), minutes: 480 },
			{ label: T("chat.mute1d"), minutes: 1440 },
			{ label: T("chat.muteAlways"), minutes: -1 },
		];
		const unmuteButton = Element("button", { className: "secondary-button", text: T("chat.unmute"), on: { click: () => Mute(0) } });
		const muteBar = Element("div", { className: "leave-bar" },
		[
			muteStatus,
			muteError,
			Element("div", { className: "chip-row" },
			[
				...muteChoices.map((choice) => Element("button", { className: "secondary-button", text: choice.label, on: { click: () => Mute(choice.minutes) } })),
				unmuteButton,
				Element("button", { className: "secondary-button", text: T("common.close"), on: { click: () => ShowBar(null) } }),
			]),
		]);

		// ========================
		// Block Bars
		// ========================

		const blockError = Element("span", { className: "form-error" });
		const blockText = Element("span", { className: "leave-text" });
		const blockBar = Element("div", { className: "leave-bar" },
		[
			blockText,
			blockError,
			Element("div", { className: "button-row" },
			[
				Element("button", { className: "secondary-button", text: T("common.cancel"), on: { click: () => ShowBar(null) } }),
				Element("button", { className: "danger-button", text: T("common.block"), on: { click: () => SetBlocked(true) } }),
			]),
		]);
		const blockedNotice = Element("div", { className: "unknown-bar" },
		[
			Element("span", { className: "leave-text", text: T("chat.youBlocked") }),
			Element("button", { className: "secondary-button", text: T("common.unblock"), on: { click: () => SetBlocked(false) } }),
		]);
		const readOnlyNotice = Element("div", { className: "read-only-bar" });

		// ========================
		// Leave Bar
		// ========================

		const leaveError = Element("span", { className: "form-error" });
		const leaveConfirm = Element("button", { className: "danger-button", text: T("chat.leave") });
		const leaveCancel = Element("button", { className: "secondary-button", text: T("chat.stay"), on: { click: () => ShowBar(null) } });
		const leaveBar = Element("div", { className: "leave-bar" },
		[
			Element("span", { className: "leave-text", text: T("chat.leaveQuestion") }),
			leaveError,
			Element("div", { className: "button-row" }, [leaveCancel, leaveConfirm]),
		]);

		// ========================
		// Location Bar
		// ========================

		const locationError = Element("span", { className: "form-error" });
		const locationConfirm = Element("button", { className: "primary-button", text: T("chat.sendLocation") });
		const locationBar = Element("div", { className: "leave-bar" },
		[
			Element("span", { className: "leave-text", text: T("chat.locationQuestion") }),
			locationError,
			Element("div", { className: "button-row" },
			[
				Element("button", { className: "secondary-button", text: T("common.cancel"), on: { click: () => ShowBar(null) } }),
				locationConfirm,
			]),
		]);

		// ========================
		// Poll Bar
		// ========================

		const maxPollOptions = config.pollMaxOptions || 10;
		const pollError = Element("span", { className: "form-error" });
		const pollQuestion = Element("input", { className: "text-input", attributes: { type: "text", maxlength: config.pollMaxQuestionLength || 200, placeholder: T("chat.pollQuestion") } });
		const pollOptions = Element("div", { className: "poll-inputs" });
		const pollAddOption = Element("button", { className: "secondary-button", on: { click: () => AddPollOption("") } });
		const pollMultiple = Element("button", { className: "toggle", title: T("chat.pollMultiple"), attributes: { role: "switch", "aria-checked": "false" } });
		const pollSend = Element("button", { className: "primary-button", text: T("chat.pollSend") });
		const pollBar = Element("div", { className: "leave-bar poll-bar" },
		[
			Element("span", { className: "leave-text", text: T("chat.pollIntro") }),
			pollQuestion,
			pollOptions,
			pollAddOption,
			Element("div", { className: "setting-row" },
			[
				Element("span", { className: "setting-text" }, [Element("span", { className: "row-title", text: T("chat.pollMultiple") })]),
				pollMultiple,
			]),
			pollError,
			Element("div", { className: "button-row" },
			[
				Element("button", { className: "secondary-button", text: T("common.cancel"), on: { click: () => ShowBar(null) } }),
				pollSend,
			]),
		]);

		pollAddOption.innerHTML = Owls.Icons.plus;
		pollAddOption.appendChild(Element("span", { text: T("chat.pollAddOption") }));
		pollMultiple.addEventListener("click", () =>
		{
			const isOn = !pollMultiple.classList.contains("is-on");
			pollMultiple.classList.toggle("is-on", isOn);
			pollMultiple.setAttribute("aria-checked", String(isOn));
		});

		// ========================
		// Attachments
		// ========================

		/// <summary>
		/// What owls may carry here ({ galleons (most per owl, 0 when off), items, gear, maxItemStacks, postage, returnAfterDays }), or null when they carry nothing.
		/// </summary>
		const parcelConfig = config.parcels || null;

		/// <summary>
		/// Galleons attached to the next owl sent from this composer; 0 for none.
		/// </summary>
		let attachedGalleons = 0;

		/// <summary>
		/// Items attached to the next owl, by key: { key, label, kind, amount }.
		/// </summary>
		const attachedItems = new Map();

		/// <summary>
		/// The item picker's rows as last fetched, in order: { key, kind, label, icon, amount, reason, input }.
		/// </summary>
		let carriable = [];

		const parcelError = Element("span", { className: "form-error" });
		const parcelAmount = Element("input", { className: "text-input", attributes: { type: "number", min: "1", max: String(parcelConfig ? parcelConfig.galleons : 1), step: "1", placeholder: T("parcel.amountPlaceholder") } });
		const parcelAttach = Element("button", { className: "primary-button", text: T("parcel.attachShort") });
		const parcelBar = Element("div", { className: "leave-bar parcel-bar" },
		[
			Element("span", { className: "leave-text", text: T("parcel.intro") }),
			parcelAmount,
			Element("span", { className: "parcel-terms", text: GetParcelTerms() }),
			parcelError,
			Element("div", { className: "button-row" },
			[
				Element("button", { className: "secondary-button", text: T("common.cancel"), on: { click: () => ShowBar(null) } }),
				parcelAttach,
			]),
		]);

		const itemsError = Element("span", { className: "form-error" });
		const itemsList = Element("div", { className: "parcel-picker" });
		const itemsAttach = Element("button", { className: "primary-button", text: T("parcel.attachShort"), on: { click: () => AttachItems() } });
		const itemsBar = Element("div", { className: "leave-bar parcel-bar" },
		[
			Element("span", { className: "leave-text", text: T("parcel.itemsIntro") }),
			itemsList,
			Element("span", { className: "parcel-terms", text: GetParcelTerms() }),
			itemsError,
			Element("div", { className: "button-row" },
			[
				Element("button", { className: "secondary-button", text: T("common.cancel"), on: { click: () => ShowBar(null) } }),
				itemsAttach,
			]),
		]);

		/// <summary>
		/// The terms shown under a parcel: when uncollected parcels go back, and the postage if there is any.
		/// </summary>
		/// <returns>Text</returns>
		function GetParcelTerms()
		{
			if (!parcelConfig)
			{
				return "";
			}

			const terms = T("parcel.terms", { count: parcelConfig.returnAfterDays });
			return parcelConfig.postage > 0 ? `${terms} ${T("parcel.postage", { count: parcelConfig.postage })}` : terms;
		}

		/// <summary>
		/// Attach the amount typed in the Galleons bar to the next owl.
		/// </summary>
		function AttachGalleons()
		{
			const amount = Number(parcelAmount.value);

			if (!Number.isInteger(amount) || amount < 1)
			{
				parcelError.textContent = T("error.parcel.invalid");
				return;
			}

			if (amount > parcelConfig.galleons)
			{
				parcelError.textContent = T("error.parcel.tooMany", { max: parcelConfig.galleons });
				return;
			}

			attachedGalleons = amount;
			UpdateParcelChip();
			ShowBar(null);
			input.focus();
		}

		parcelAttach.addEventListener("click", AttachGalleons);
		parcelAmount.addEventListener("keydown", (event) =>
		{
			if (event.key === "Enter")
			{
				event.preventDefault();
				AttachGalleons();
			}
		});

		/// <summary>
		/// Open the item picker with what the player could send right now. The server reads the inventory, and checks everything again when the owl is sent.
		/// </summary>
		async function OpenItems()
		{
			ShowBar(itemsBar);
			itemsList.replaceChildren(Element("span", { className: "parcel-picker-note", text: T("parcel.loading") }));
			const result = await Owls.Bridge.Request("parcels.carriable", {});

			if (itemsBar.hidden)
			{
				return;
			}

			if (!result.ok)
			{
				itemsList.replaceChildren();
				itemsError.textContent = result.error;
				return;
			}

			carriable = (result.data.items || []).map((item) => ({ ...item }));
			RenderItems();
		}

		/// <summary>
		/// Draw the picker: one row per item with an amount to send, and the reason under any item that cannot travel.
		/// </summary>
		function RenderItems()
		{
			if (carriable.length === 0)
			{
				itemsList.replaceChildren(Element("span", { className: "parcel-picker-note", text: T("parcel.noItems") }));
				return;
			}

			itemsList.replaceChildren(...carriable.map((item) =>
			{
				const attached = attachedItems.get(item.key);
				item.input = Element("input", { className: "parcel-picker-amount", attributes: { type: "number", min: "0", max: String(item.amount), step: "1", value: attached ? String(attached.amount) : "0", "aria-label": item.label } });
				item.input.disabled = !!item.reason;
				return Element("label", { className: `parcel-picker-row${item.reason ? " is-disabled" : ""}` },
				[
					CreateItemIcon(item),
					Element("span", { className: "parcel-picker-text" },
					[
						Element("span", { className: "parcel-picker-label", text: item.label }),
						Element("span", { className: "parcel-picker-detail", text: item.reason || T("parcel.owned", { count: item.amount }) }),
					]),
					item.input,
				]);
			}));
		}

		/// <summary>
		/// An item's picture, or a parcel icon when it has none the page can load.
		/// </summary>
		/// <param name="item">{ icon, kind }</param>
		/// <returns>Element</returns>
		function CreateItemIcon(item)
		{
			const holder = Element("span", { className: "parcel-item-icon" });

			if (/^(https?|fw):\/\//i.test(item.icon || ""))
			{
				const image = Element("img", { attributes: { src: item.icon, alt: "" } });
				image.addEventListener("error", () => { holder.innerHTML = Owls.Icons.parcel; });
				holder.appendChild(image);
			}
			else
			{
				holder.innerHTML = Owls.Icons.parcel;
			}

			return holder;
		}

		/// <summary>
		/// Attach the amounts chosen in the picker to the next owl, replacing what was attached before.
		/// </summary>
		function AttachItems()
		{
			const chosen = [];

			for (const item of carriable)
			{
				const amount = item.input ? Number(item.input.value) : 0;

				if (!Number.isInteger(amount) || amount < 0 || amount > item.amount)
				{
					itemsError.textContent = T("error.parcel.invalid");
					return;
				}

				if (amount > 0 && !item.reason)
				{
					chosen.push({ key: item.key, label: item.label, kind: item.kind, amount });
				}
			}

			if (chosen.length > parcelConfig.maxItemStacks)
			{
				itemsError.textContent = T("error.parcel.tooManyItems", { max: parcelConfig.maxItemStacks });
				return;
			}

			attachedItems.clear();

			for (const item of chosen)
			{
				attachedItems.set(item.key, item);
			}

			UpdateParcelChip();
			ShowBar(null);
			input.focus();
		}

		/// <summary>
		/// Take everything off the next owl.
		/// </summary>
		function ClearParcel()
		{
			attachedGalleons = 0;
			attachedItems.clear();
			UpdateParcelChip();
		}

		/// <summary>
		/// The parcel to send with the next owl: what the server needs, and what the pending bubble shows until it answers.
		/// </summary>
		/// <returns>{ request, display }, or null when nothing is attached</returns>
		function GetParcel()
		{
			const items = [...attachedItems.values()];

			if (attachedGalleons <= 0 && items.length === 0)
			{
				return null;
			}

			return {
				request: { galleons: attachedGalleons, items: items.map((item) => ({ key: item.key, amount: item.amount })) },
				display: { galleons: attachedGalleons, items: items.map((item) => ({ label: item.label, amount: item.amount, kind: item.kind, icon: "" })) },
			};
		}

		/// <summary>
		/// One choice of the attach menu: a round icon over its name, like a phone's share sheet.
		/// </summary>
		/// <param name="icon">Icon markup</param>
		/// <param name="label">Its name</param>
		/// <param name="onClick">What it opens</param>
		/// <returns>Button element</returns>
		function CreateAttachOption(icon, label, onClick)
		{
			const glyph = Element("span", { className: "attach-glyph" });
			glyph.innerHTML = icon;
			return Element("button", { className: "attach-option", on: { click: () => { ShowAttachMenu(false); onClick(); } } }, [glyph, Element("span", { className: "attach-label", text: label })]);
		}

		const galleonsOption = CreateAttachOption(Owls.Icons.coins, T("parcel.menu.galleons"), () => ShowBar(parcelBar));
		const itemsOption = CreateAttachOption(Owls.Icons.parcel, T("parcel.menu.items"), () => OpenItems());
		const locationOption = CreateAttachOption(Owls.Icons.location, T("chat.location"), () => ShowBar(locationBar));
		const pollOption = CreateAttachOption(Owls.Icons.poll, T("chat.poll"), () => ShowBar(pollBar));
		const attachMenu = Element("div", { className: "attach-menu" }, [galleonsOption, itemsOption, locationOption, pollOption]);
		attachMenu.hidden = true;

		/// <summary>
		/// Open or close the attach menu above the composer. It shares that place with the emoji picker, so opening one closes the other.
		/// </summary>
		/// <param name="show">Whether to open it</param>
		function ShowAttachMenu(show)
		{
			attachMenu.hidden = !show;
			attachButton.classList.toggle("is-open", show);

			if (show)
			{
				emojiPicker.Hide();
				emojiButton.classList.remove("is-active");
			}
		}

		/// <summary>
		/// Add one more answer field to the poll being written.
		/// </summary>
		/// <param name="text">Its starting text</param>
		function AddPollOption(text)
		{
			const count = pollOptions.children.length;

			if (count >= maxPollOptions)
			{
				return;
			}

			const field = Element("input", { className: "text-input", attributes: { type: "text", maxlength: config.pollMaxOptionLength || 100, placeholder: T("chat.pollOption", { count: count + 1 }) } });
			field.value = text;
			pollOptions.appendChild(field);
			pollAddOption.hidden = pollOptions.children.length >= maxPollOptions;

			if (count >= 2)
			{
				field.focus();
			}
		}

		/// <summary>
		/// Empty the poll form, with the two answers every poll needs.
		/// </summary>
		function ResetPoll()
		{
			pollQuestion.value = "";
			pollOptions.replaceChildren();
			pollMultiple.classList.remove("is-on");
			pollMultiple.setAttribute("aria-checked", "false");
			AddPollOption("");
			AddPollOption("");
		}

		ResetPoll();

		// ========================
		// Owl Actions Bar
		// ========================

		const actionError = Element("span", { className: "form-error" });
		const actionText = Element("span", { className: "leave-text" });
		const replyAction = ActionButton(Owls.Icons.reply, T("chat.reply"), () => StartReply());
		const forwardAction = ActionButton(Owls.Icons.forward, T("chat.forward"), () => ForwardSelected());
		const pinAction = ActionButton(Owls.Icons.thumbtack, T("chat.pin"), () => TogglePinSelected());
		const hideAction = ActionButton(Owls.Icons.trash, T("chat.deleteForMe"), () => Confirm("hide", hideAction, HideSelected));
		const unsendAction = ActionButton(Owls.Icons.unsend, T("chat.unsend"), () => Confirm("unsend", unsendAction, UnsendSelected));
		const actionBar = Element("div", { className: "leave-bar action-bar" },
		[
			actionText,
			actionError,
			Element("div", { className: "chip-row" },
			[
				replyAction,
				forwardAction,
				pinAction,
				hideAction,
				unsendAction,
				Element("button", { className: "secondary-button", text: T("common.close"), on: { click: () => Select(0) } }),
			]),
		]);

		/// <summary>
		/// Build one button of the owl actions bar.
		/// </summary>
		/// <param name="icon">Icon markup</param>
		/// <param name="label">Button text</param>
		/// <param name="onClick">Click handler</param>
		/// <returns>Button element</returns>
		function ActionButton(icon, label, onClick)
		{
			const button = Element("button", { className: "secondary-button", on: { click: onClick } });
			button.innerHTML = icon;
			button.appendChild(Element("span", { text: label }));
			button.dataset.label = label;
			return button;
		}

		/// <summary>
		/// Show one of the confirmation bars, hiding the others; null hides them all.
		/// </summary>
		/// <param name="bar">Bar element, or null</param>
		function ShowBar(bar)
		{
			for (const candidate of [muteBar, blockBar, leaveBar, locationBar, pollBar, parcelBar, itemsBar])
			{
				candidate.hidden = candidate !== bar;
			}

			muteError.textContent = "";
			blockError.textContent = "";
			leaveError.textContent = "";
			locationError.textContent = "";
			pollError.textContent = "";
			parcelError.textContent = "";
			itemsError.textContent = "";

			if (bar)
			{
				ShowAttachMenu(false);
			}

			if (bar)
			{
				Select(0);
			}

			if (bar === pollBar)
			{
				pollQuestion.focus();
			}

			if (bar === parcelBar)
			{
				parcelAmount.value = attachedGalleons > 0 ? String(attachedGalleons) : "";
				parcelAmount.focus();
			}
		}

		ShowBar(null);

		// ========================
		// Unknown Owl Bar
		// ========================

		const saveNameInput = Element("input", { className: "text-input", attributes: { type: "text", maxlength: config.maxNameLength || 40, placeholder: T("chat.nameThisOwl") } });
		const saveButton = Element("button", { className: "secondary-button", text: T("common.save") });
		const unknownBar = Element("div", { className: "unknown-bar" }, [saveNameInput, saveButton]);

		// ========================
		// History & Composer
		// ========================

		const messages = Element("div", { className: "messages" });
		const typingText = Element("span");
		const typingRow = Element("div", { className: "typing-row" }, [Element("span", { className: "typing-dots" }, [Element("i"), Element("i"), Element("i")]), typingText]);
		const body = Element("div", { className: "screen-body" }, [messages, typingRow]);
		const input = Element("textarea", { className: "text-area", attributes: { rows: 1, maxlength: maxLength, placeholder: T("chat.placeholder") } });
		const sendButton = Widgets.IconButton(Owls.Icons.send, T("chat.send"), () => Send(), "send-button");
		const emojiPicker = Owls.EmojiPicker.Create((emoji) => InsertText(emoji));
		const emojiButton = Widgets.IconButton(Owls.Icons.smile, T("chat.emoji"), () => ToggleEmoji(), "composer-button");
		const attachButton = Widgets.IconButton(Owls.Icons.paperclip, T("parcel.attachMenu"), () => ShowAttachMenu(attachMenu.hidden), "composer-button");
		const parcelChipText = Element("span", { className: "reply-name" });
		const parcelChipIcon = Element("span", { className: "reply-icon" });
		parcelChipIcon.innerHTML = Owls.Icons.parcel;
		const parcelChip = Element("div", { className: "reply-bar parcel-chip" }, [parcelChipIcon, Element("span", { className: "reply-text" }, [parcelChipText, Element("span", { className: "reply-snippet", text: T("parcel.attachedHint") })]), Widgets.IconButton(Owls.Icons.close, T("parcel.remove"), () => ClearParcel())]);
		const counter = Element("div", { className: "composer-counter" });
		const replyName = Element("span", { className: "reply-name" });
		const replySnippet = Element("span", { className: "reply-snippet" });
		const replyIcon = Element("span", { className: "reply-icon" });
		replyIcon.innerHTML = Owls.Icons.reply;
		const replyBar = Element("div", { className: "reply-bar" }, [replyIcon, Element("span", { className: "reply-text" }, [replyName, replySnippet]), Widgets.IconButton(Owls.Icons.close, T("chat.cancelReply"), () => SetReply(null))]);
		const composer = Element("div", { className: "composer" }, [attachButton, input, emojiButton, sendButton]);
		const element = Element("div", { className: "screen" }, [header, searchRow, pinnedBar, headerError, muteBar, blockBar, leaveBar, locationBar, pollBar, parcelBar, itemsBar, blockedNotice, unknownBar, searchResults, body, counter, readOnlyNotice, actionBar, replyBar, parcelChip, attachMenu, emojiPicker.element, composer]);

		replyBar.hidden = true;
		parcelChip.hidden = true;

		/// <summary>
		/// Show what the next owl carries above the composer, or hide the strip when it carries nothing.
		/// </summary>
		function UpdateParcelChip()
		{
			const parts = [];

			if (attachedGalleons > 0)
			{
				parts.push(T("parcel.galleons", { count: attachedGalleons }));
			}

			if (attachedItems.size > 0)
			{
				parts.push(T("parcel.itemCount", { count: [...attachedItems.values()].reduce((sum, item) => sum + item.amount, 0) }));
			}

			parcelChip.hidden = parts.length === 0;
			parcelChipText.textContent = parts.join(" · ");
			attachButton.classList.toggle("is-active", parts.length > 0);
		}
		actionBar.hidden = true;
		typingRow.hidden = true;

		/// <summary>
		/// The chat as currently stored.
		/// </summary>
		/// <returns>Chat summary</returns>
		function GetChat()
		{
			return Owls.Store.state.chats.get(chatId);
		}

		/// <summary>
		/// The contact behind a direct chat, if saved.
		/// </summary>
		/// <returns>Contact record or null</returns>
		function GetContact()
		{
			const chat = GetChat();
			return chat && chat.kind === "direct" ? Owls.Store.state.contactsByNumber.get(Owls.Store.GetOtherMember(chat)) || null : null;
		}

		/// <summary>
		/// Whether the player may pin owls here: either owl of a one-to-one chat, or a bulk owl's admins.
		/// </summary>
		/// <returns>True when allowed</returns>
		function CanPinOwls()
		{
			const chat = GetChat();
			return !!chat && (chat.kind === "direct" || Owls.Store.IsAdmin(chat));
		}

		/// <summary>
		/// One line about an owl, for quotes, the pinned bar and the actions bar.
		/// </summary>
		/// <param name="quote">Message, or a quote { sender, kind, body, unsent }</param>
		/// <returns>Text</returns>
		function DescribeOwl(quote)
		{
			if (!quote.sender)
			{
				return T("error.owlGone");
			}

			if (quote.sender !== Owls.Store.state.me.number && Owls.Store.IsBlocked(quote.sender))
			{
				return T("owls.fromBlocked");
			}

			return Owls.Store.GetMessageText({ ...quote, unsentAt: quote.unsent || Number(quote.unsentAt) > 0 ? 1 : 0 }).replace(/\s+/g, " ");
		}

		/// <summary>
		/// Redraw the header, the pinned owl and decide whether the "save this owl" bar is needed.
		/// </summary>
		function RenderHeader()
		{
			const chat = GetChat();

			if (!chat)
			{
				return;
			}

			headerAvatar.replaceChildren(Owls.Store.CreateChatAvatar(chat, "is-small"));
			headerTitle.textContent = Owls.Store.GetChatTitle(chat);
			RenderTyping();

			const other = chat.kind === "direct" ? Owls.Store.GetOtherMember(chat) : "";
			const isOfficial = !!(other && Owls.Store.GetSender(other));
			const isBlocked = !!(other && Owls.Store.IsBlocked(other));
			const isRetired = !!(other && Owls.Store.IsRetired(other));
			const writeState = Owls.Store.GetWriteState(chat);
			const isMuted = Owls.Store.IsMuted(chat);
			const isPinned = Number(chat.pinnedAt) > 0;

			unknownBar.hidden = !(chat.kind === "direct" && !isOfficial && !GetContact());
			leaveButton.hidden = chat.kind !== "group";
			callButton.hidden = chat.kind !== "direct" || !Owls.Store.GetCallState(other).canCall;
			blockButton.hidden = chat.kind !== "direct" || isOfficial || isBlocked || isRetired;
			blockedNotice.hidden = !isBlocked;
			blockText.textContent = T("chat.blockQuestion", { name: headerTitle.textContent });

			pinChatButton.hidden = (config.maxPinnedChats ?? 5) === 0;
			pinChatButton.classList.toggle("is-active", isPinned);
			pinChatButton.title = isPinned ? T("chat.unpinChat") : T("chat.pinChat");

			muteButton.innerHTML = isMuted ? Owls.Icons.bellSlash : Owls.Icons.bell;
			muteButton.title = isMuted ? T("chat.muted") : T("chat.notifications");
			muteButton.classList.toggle("is-muted", isMuted);
			unmuteButton.hidden = !isMuted;
			const mutedUntilLocal = Number(chat.mutedUntil) - Owls.Store.state.serverOffsetMs;
			const isMutedToday = Owls.Util.GetDayStart(mutedUntilLocal) === Owls.Util.GetDayStart(Date.now());
			muteStatus.textContent = !isMuted ? T("chat.muteQuestion") : Number(chat.mutedUntil) > Owls.Store.GetServerNow() + 365 * 24 * 3600000 ? T("chat.mutedForever") : isMutedToday ? T("chat.mutedUntilToday", { time: Owls.Util.FormatClock(mutedUntilLocal) }) : T("chat.mutedUntil", { day: Owls.Util.FormatDay(mutedUntilLocal), time: Owls.Util.FormatClock(mutedUntilLocal) });

			const pinned = chat.pinnedMessage;
			pinnedBar.hidden = !pinned;
			unpinButton.hidden = !CanPinOwls();

			if (pinned)
			{
				pinnedText.textContent = T("chat.quoteLine", { name: Owls.Store.GetDisplayName(pinned.sender), text: DescribeOwl(pinned) });
			}

			const canWrite = writeState.canWrite && !isBlocked;
			composer.hidden = !canWrite;
			// Parcels travel only on a one-to-one owl to another player.
			const canCarry = !!parcelConfig && chat.kind === "direct" && !isOfficial;
			galleonsOption.hidden = !canCarry || !parcelConfig.galleons;
			itemsOption.hidden = !canCarry || (!parcelConfig.items && !parcelConfig.gear);
			locationOption.hidden = !config.locationsEnabled || isOfficial;
			pollOption.hidden = chat.kind !== "group" || !config.pollsEnabled;
			attachButton.hidden = [galleonsOption, itemsOption, locationOption, pollOption].every((option) => option.hidden);

			if (attachButton.hidden)
			{
				ShowAttachMenu(false);
			}

			if (!canCarry && (attachedGalleons > 0 || attachedItems.size > 0))
			{
				ClearParcel();
			}

			if (!canWrite)
			{
				emojiPicker.Hide();
				locationBar.hidden = true;
				pollBar.hidden = true;
				SetReply(null);
			}

			counter.hidden = counter.hidden || !canWrite;
			readOnlyNotice.hidden = writeState.canWrite;
			readOnlyNotice.textContent = writeState.reason;
		}

		/// <summary>
		/// Show who is typing, in the header and as a line under the history.
		/// </summary>
		function RenderTyping()
		{
			const chat = GetChat();

			if (!chat)
			{
				return;
			}

			const isGroup = chat.kind === "group";
			const typing = Owls.Store.GetTypingText(chatId, isGroup);
			const wasHidden = typingRow.hidden;

			typingRow.hidden = typing === "";
			typingText.textContent = Owls.Store.GetTypingText(chatId, true);
			headerSub.classList.toggle("is-typing", typing !== "");

			if (typing)
			{
				headerSub.textContent = typing;
				headerSub.hidden = false;
			}
			else if (isGroup)
			{
				headerSub.textContent = chat.members.map((member) => Owls.Store.GetDisplayName(member)).join(T("common.listSeparator"));
				headerSub.hidden = false;
			}
			else
			{
				headerSub.hidden = true;
			}

			// Keep following the conversation when the typing line appears under it.
			if (wasHidden && !typingRow.hidden && body.scrollHeight - body.scrollTop - body.clientHeight < stickToBottomPx + 40)
			{
				body.scrollTop = body.scrollHeight;
			}
		}

		/// <summary>
		/// Show a short-lived error under the header (for owl actions and pins).
		/// </summary>
		/// <param name="text">Error text, or "" to clear it</param>
		function ShowError(text)
		{
			headerError.textContent = text;
		}

		/// <summary>
		/// Mute or unmute this chat's notifications.
		/// </summary>
		/// <param name="minutes">60, 480, 1440, -1 (until unmuted) or 0 (unmute)</param>
		async function Mute(minutes)
		{
			const result = await Owls.Bridge.Request("chats.mute", { chatId, minutes });

			if (!result.ok)
			{
				muteError.textContent = result.error;
				return;
			}

			Owls.Store.SetMuted(chatId, result.data.mutedUntil);
			ShowBar(null);
		}

		/// <summary>
		/// Call the other owl of this one-to-one chat.
		/// </summary>
		function Call()
		{
			const chat = GetChat();
			const result = chat ? Owls.App.StartCall({ number: Owls.Store.GetOtherMember(chat) }) : { ok: false, error: T("error.chatGone") };
			ShowError(result.ok ? "" : result.error);
		}

		/// <summary>
		/// Pin this chat to the top of the chat list, or unpin it.
		/// </summary>
		async function PinChat()
		{
			const chat = GetChat();
			const result = await Owls.Bridge.Request("chats.pin", { chatId, pinned: !(chat && Number(chat.pinnedAt) > 0) });

			ShowError(result.ok ? "" : result.error);

			if (result.ok)
			{
				Owls.Store.SetChatPinned(chatId, result.data.pinnedAt);
			}
		}

		/// <summary>
		/// Block or unblock the other owl of this one-to-one chat.
		/// </summary>
		/// <param name="block">True to block</param>
		async function SetBlocked(block)
		{
			const chat = GetChat();
			const number = chat ? Owls.Store.GetOtherMember(chat) : "";
			const result = await Owls.Bridge.Request(block ? "blocks.add" : "blocks.remove", { number });

			if (!result.ok)
			{
				blockError.textContent = result.error;
				return;
			}

			Owls.Store.SetBlocked(number, block);
			ShowBar(null);
		}

		/// <summary>
		/// Leave the bulk owl, then return to the chat list without it.
		/// </summary>
		async function Leave()
		{
			leaveConfirm.disabled = true;
			const result = await Owls.Bridge.Request("chats.leave", { chatId });
			leaveConfirm.disabled = false;

			if (!result.ok)
			{
				leaveError.textContent = result.error;
				return;
			}

			Owls.App.Back();
			Owls.Store.RemoveChat(chatId);
		}

		leaveConfirm.addEventListener("click", Leave);

		// ========================
		// Owl Actions
		// ========================

		/// <summary>
		/// The loaded message with an ID.
		/// </summary>
		/// <param name="messageId">Message ID</param>
		/// <returns>Message record, or null</returns>
		function FindMessage(messageId)
		{
			return Owls.Store.GetHistory(chatId).messages.find((message) => message.id === messageId) || null;
		}

		/// <summary>
		/// Whether an owl of the player's own can still be unsent.
		/// </summary>
		/// <param name="message">Message record</param>
		/// <returns>True while inside the server's unsend window</returns>
		function CanUnsend(message)
		{
			const seconds = Number(config.unsendSeconds) || 0;
			return seconds > 0 && message.sender === Owls.Store.state.me.number && !(Number(message.unsentAt) > 0) && Owls.Store.GetServerNow() - message.sentAt < seconds * 1000;
		}

		/// <summary>
		/// Whether an owl can be forwarded: written owls and locations, not polls (which belong to their bulk owl) or unsent owls.
		/// </summary>
		/// <param name="message">Message record</param>
		/// <returns>True when Forward is offered</returns>
		function CanForward(message)
		{
			if ((config.maxForwardTargets ?? 5) === 0 || Number(message.unsentAt) > 0)
			{
				return false;
			}

			return message.kind === "location" ? !!config.locationsEnabled : !message.kind || message.kind === "text";
		}

		/// <summary>
		/// Choose where the selected owl goes.
		/// </summary>
		function ForwardSelected()
		{
			const messageId = selectedId;
			Select(0);
			Owls.App.Navigate("Forward", { chatId, messageId });
		}

		/// <summary>
		/// Select an owl to act on, or clear the selection with 0.
		/// </summary>
		/// <param name="messageId">Message ID, or 0</param>
		function Select(messageId)
		{
			const message = messageId > 0 ? FindMessage(messageId) : null;
			selectedId = message ? message.id : 0;
			pendingConfirm = "";
			clearTimeout(confirmTimer);
			actionError.textContent = "";
			actionBar.hidden = !message;

			for (const bubble of messages.querySelectorAll(".bubble.is-selected"))
			{
				bubble.classList.remove("is-selected");
			}

			if (!message)
			{
				return;
			}

			const chat = GetChat();
			const isUnsent = Number(message.unsentAt) > 0;
			const isPinned = !!(chat && chat.pinnedMessage && chat.pinnedMessage.id === message.id);
			const bubble = messages.querySelector(`[data-message-id="${message.id}"]`);

			if (bubble)
			{
				bubble.classList.add("is-selected");
			}

			// Hide the other bars so only one strip of buttons is ever open.
			for (const bar of [muteBar, blockBar, leaveBar, locationBar, pollBar])
			{
				bar.hidden = true;
			}

			actionText.textContent = T("chat.quoteLine", { name: Owls.Store.GetDisplayName(message.sender), text: DescribeOwl(message) });
			replyAction.hidden = isUnsent || composer.hidden;
			forwardAction.hidden = !CanForward(message);
			pinAction.hidden = isUnsent || !CanPinOwls();
			pinAction.lastChild.textContent = isPinned ? T("chat.unpin") : T("chat.pin");
			unsendAction.hidden = !CanUnsend(message);

			for (const button of [hideAction, unsendAction])
			{
				button.lastChild.textContent = button.dataset.label;
			}
		}

		/// <summary>
		/// Run a destructive action on its second tap; the first tap asks for it.
		/// </summary>
		/// <param name="key">Which action</param>
		/// <param name="button">The action's button</param>
		/// <param name="Action">Function to run once confirmed</param>
		function Confirm(key, button, Action)
		{
			if (pendingConfirm === key)
			{
				pendingConfirm = "";
				clearTimeout(confirmTimer);
				Action();
				return;
			}

			pendingConfirm = key;
			hideAction.lastChild.textContent = hideAction.dataset.label;
			unsendAction.lastChild.textContent = unsendAction.dataset.label;
			button.lastChild.textContent = T("chat.tapAgain");
			clearTimeout(confirmTimer);
			confirmTimer = setTimeout(() =>
			{
				pendingConfirm = "";
				button.lastChild.textContent = button.dataset.label;
			}, confirmWindowMs);
		}

		/// <summary>
		/// Answer the selected owl: the composer shows what is being answered.
		/// </summary>
		function StartReply()
		{
			const message = FindMessage(selectedId);
			Select(0);

			if (message)
			{
				SetReply({ id: message.id, sender: message.sender, kind: message.kind, body: message.body, unsent: false });
				input.focus();
			}
		}

		/// <summary>
		/// Set or clear the owl the next one answers.
		/// </summary>
		/// <param name="quote">Quote { id, sender, kind, body }, or null</param>
		function SetReply(quote)
		{
			replyTo = quote;
			replyBar.hidden = !quote;

			if (quote)
			{
				replyName.textContent = quote.sender === Owls.Store.state.me.number ? T("chat.replyingSelf") : T("chat.replyingTo", { name: Owls.Store.GetDisplayName(quote.sender) });
				replySnippet.textContent = DescribeOwl(quote);
			}
		}

		/// <summary>
		/// Pin the selected owl, or unpin it if it is the pinned one.
		/// </summary>
		function TogglePinSelected()
		{
			const chat = GetChat();
			const isPinned = !!(chat && chat.pinnedMessage && chat.pinnedMessage.id === selectedId);
			const target = isPinned ? 0 : selectedId;
			Select(0);
			PinMessage(target);
		}

		/// <summary>
		/// Pin an owl at the top of the chat for everyone, or take the pin down with 0.
		/// </summary>
		/// <param name="messageId">Message ID, or 0</param>
		async function PinMessage(messageId)
		{
			const result = await Owls.Bridge.Request("messages.pin", { chatId, messageId });
			ShowError(result.ok ? "" : result.error);

			if (result.ok)
			{
				Owls.Store.UpsertChat({ id: chatId, pinnedMessage: result.data.pinnedMessage });
			}
		}

		/// <summary>
		/// Delete the selected owl from this phone only.
		/// </summary>
		async function HideSelected()
		{
			const messageId = selectedId;
			const result = await Owls.Bridge.Request("messages.hide", { chatId, messageId });

			if (!result.ok)
			{
				actionError.textContent = result.error;
				return;
			}

			Select(0);
			Owls.Store.RemoveMessage(chatId, messageId);
		}

		/// <summary>
		/// Take back the selected owl for everyone.
		/// </summary>
		async function UnsendSelected()
		{
			const messageId = selectedId;
			const result = await Owls.Bridge.Request("messages.unsend", { chatId, messageId });

			if (!result.ok)
			{
				actionError.textContent = result.error;
				return;
			}

			Select(0);
			Owls.Store.MarkUnsent(chatId, messageId, result.data.unsentAt);
		}

		/// <summary>
		/// Scroll to an owl and make it glow for a moment (from a quote, the pinned bar or a search result).
		/// An owl further back than the loaded history is reached by loading older pages first.
		/// </summary>
		/// <param name="messageId">Message ID</param>
		async function JumpTo(messageId)
		{
			if (isJumping)
			{
				return;
			}

			const history = Owls.Store.GetHistory(chatId);
			let bubble = messages.querySelector(`[data-message-id="${messageId}"]`);

			// IDs only grow, so an owl older than the oldest one loaded can only be on an older page.
			isJumping = true;

			for (let page = 0; !bubble && page < maxJumpPages && history.hasMore && history.messages.length > 0 && history.messages[0].id > messageId; ++page)
			{
				await LoadOlder();
				bubble = messages.querySelector(`[data-message-id="${messageId}"]`);
			}

			isJumping = false;

			if (!bubble)
			{
				ShowError(history.hasMore && history.messages.length > 0 && history.messages[0].id > messageId ? T("chat.jumpFurther") : T("chat.jumpGone"));
				return;
			}

			ShowError("");
			bubble.scrollIntoView({ block: "center" });
			bubble.classList.remove("is-flashing");

			// Restart the animation even when the same owl is jumped to twice.
			void bubble.offsetWidth;
			bubble.classList.add("is-flashing");
		}

		pinnedJump.addEventListener("click", () =>
		{
			const chat = GetChat();

			if (chat && chat.pinnedMessage)
			{
				JumpTo(chat.pinnedMessage.id);
			}
		});

		// ========================
		// Search
		// ========================

		/// <summary>
		/// Open the search field under the header, or close it and go back to the chat.
		/// </summary>
		function ToggleSearch()
		{
			if (searchRow.hidden)
			{
				searchRow.hidden = false;
				searchButton.classList.add("is-active");
				Select(0);
				searchInput.focus();
				return;
			}

			CloseSearch();
		}

		/// <summary>
		/// Close the search and show the chat again.
		/// </summary>
		function CloseSearch()
		{
			clearTimeout(searchTimer);
			++searchSerial;
			searchInput.value = "";
			searchRow.hidden = true;
			searchResults.hidden = true;
			body.hidden = false;
			searchButton.classList.remove("is-active");
		}

		/// <summary>
		/// A line of a found owl's text around where the search matched.
		/// </summary>
		/// <param name="text">The owl's text in one line</param>
		/// <param name="query">What was searched for</param>
		/// <returns>{ before, match, after } so the match can be shown apart</returns>
		function GetSnippet(text, query)
		{
			const at = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());

			// The server matches without regard to accents too, so the match may not be found here; the line is then shown from its start.
			if (at < 0)
			{
				return { before: text, match: "", after: "" };
			}

			const start = Math.max(0, at - snippetLead);
			return { before: `${start > 0 ? "…" : ""}${text.slice(start, at)}`, match: text.slice(at, at + query.length), after: text.slice(at + query.length) };
		}

		/// <summary>
		/// Build the row of one found owl. Tapping it closes the search and jumps to the owl in the chat.
		/// </summary>
		/// <param name="message">Found message</param>
		/// <param name="query">What was searched for</param>
		/// <returns>Row element</returns>
		function CreateSearchRow(message, query)
		{
			const snippet = GetSnippet(Owls.Store.GetMessageText(message).replace(/\s+/g, " "), query);
			const name = Element("span", { className: "row-title", text: Owls.Store.GetDisplayName(message.sender) });
			name.style.color = Owls.Util.GetNameColour(message.sender);

			return Element("button", { className: "list-row search-result", on: { click: () =>
			{
				CloseSearch();
				JumpTo(message.id);
			} } },
			[
				Element("span", { className: "row-text" },
				[
					name,
					Element("span", { className: "row-subtitle" }, [Element("span", { text: snippet.before }), Element("mark", { text: snippet.match }), Element("span", { text: snippet.after })]),
				]),
				Element("span", { className: "row-meta" }, [Element("span", { text: Owls.Util.FormatListTime(message.sentAt) })]),
			]);
		}

		/// <summary>
		/// Look for the text in the search field across the whole chat (the server searches, not only the owls loaded here).
		/// </summary>
		async function RunSearch()
		{
			clearTimeout(searchTimer);
			const query = searchInput.value.replace(/\s+/g, " ").trim();
			const serial = ++searchSerial;

			if (query.length < minSearchLength)
			{
				searchResults.hidden = true;
				body.hidden = false;
				return;
			}

			searchResults.hidden = false;
			body.hidden = true;
			searchResults.replaceChildren(Widgets.EmptyState(T("chat.searching")));

			const result = await Owls.Bridge.Request("chats.search", { chatId, query });

			// A newer search (or closing the field) already replaced this one.
			if (serial !== searchSerial)
			{
				return;
			}

			if (!result.ok)
			{
				searchResults.replaceChildren(Widgets.EmptyState(result.error));
				return;
			}

			const found = (result.data.messages || []).filter((message) => !Owls.Store.IsBlocked(message.sender) || message.sender === Owls.Store.state.me.number);

			if (found.length === 0)
			{
				searchResults.replaceChildren(Widgets.EmptyState(T("chat.searchNone")));
				return;
			}

			const rows = found.map((message) => CreateSearchRow(message, query));

			if (result.data.hasMore)
			{
				rows.push(Widgets.EmptyState(T("chat.searchMore")));
			}

			searchResults.replaceChildren(...rows);
		}

		searchInput.addEventListener("input", () =>
		{
			clearTimeout(searchTimer);
			searchTimer = setTimeout(RunSearch, searchDelayMs);
		});
		searchInput.addEventListener("keydown", (event) =>
		{
			if (event.key === "Enter")
			{
				event.preventDefault();
				RunSearch();
			}
			else if (event.key === "Escape")
			{
				// Escape closes the search, not the chat.
				event.preventDefault();
				event.stopPropagation();
				CloseSearch();
			}
		});

		// ========================
		// Bubbles
		// ========================

		/// <summary>
		/// Build the inside of a location owl's bubble: where it was sent from, and a button that marks it on the map.
		/// </summary>
		/// <param name="message">Message with kind "location"</param>
		/// <param name="isMine">Whether the reader sent it</param>
		/// <returns>Card element</returns>
		function CreateLocationCard(message, isMine)
		{
			const location = Owls.Store.ParseLocation(message);
			const icon = Element("span", { className: "location-icon" });
			icon.innerHTML = Owls.Icons.map;

			const note = Element("span", { className: "location-note" });
			note.hidden = true;

			const card = Element("div", { className: "location-card" },
			[
				Element("div", { className: "location-head" },
				[
					icon,
					Element("span", { className: "location-text" },
					[
						Element("span", { className: "location-title", text: isMine ? T("chat.locationMine") : T("chat.location") }),
						Element("span", { className: "location-place", text: !location ? T("chat.locationUnavailable") : location.place || T("chat.locationSomewhere") }),
					]),
				]),
			]);

			if (location && message.id !== undefined)
			{
				const showButton = Element("button", { className: "secondary-button location-button" });
				showButton.dataset.messageId = String(message.id);
				UpdateLocationButton(showButton);
				showButton.addEventListener("click", (event) =>
				{
					event.stopPropagation();
					ShowOnMap(message, isMine, showButton, note);
				});
				card.appendChild(showButton);
			}

			card.appendChild(note);
			return card;
		}

		/// <summary>
		/// Label a location card's button for whether its owl is the one on the reader's map.
		/// </summary>
		/// <param name="button">Button carrying the owl's message ID in data-message-id</param>
		function UpdateLocationButton(button)
		{
			const isShown = Owls.Store.IsLocationShown(chatId, Number(button.dataset.messageId));
			const note = button.parentElement ? button.parentElement.querySelector(".location-note") : null;
			button.textContent = isShown ? T("chat.hideFromMap") : T("chat.showOnMap");

			// "Marked on your map" would be stale once the location is gone (reached, hidden or replaced); errors stay readable.
			if (!isShown && note && !note.classList.contains("is-error"))
			{
				note.hidden = true;
			}
		}

		/// <summary>
		/// Ask the server to mark a location owl on the reader's map and route them to it, or to take it off if it is already shown.
		/// </summary>
		/// <param name="message">Location message</param>
		/// <param name="isMine">Whether the reader sent it</param>
		/// <param name="button">The card's button, disabled while waiting</param>
		/// <param name="note">The card's note line, for the outcome</param>
		async function ShowOnMap(message, isMine, button, note)
		{
			button.disabled = true;
			const label = isMine ? "" : Owls.Store.GetDisplayName(message.sender);
			const result = await Owls.Bridge.Request("locations.show", { chatId, messageId: message.id, label });
			button.disabled = false;
			note.hidden = false;
			note.classList.toggle("is-error", !result.ok);

			if (!result.ok)
			{
				note.textContent = result.error;
				return;
			}

			// The button's label already says the location is off the map again.
			if (result.data.isHidden)
			{
				note.hidden = true;
				return;
			}

			note.textContent = result.data.isElsewhere ? (result.data.place ? T("chat.markedElsewherePlace", { place: result.data.place }) : T("chat.markedElsewhere")) : T("chat.marked");
		}

		/// <summary>
		/// Build the inside of a poll's bubble: the question, then one button per answer with its share of the votes and who chose it.
		/// Tapping an answer votes for it; tapping your own choice again takes it back.
		/// </summary>
		/// <param name="message">Message with kind "poll"</param>
		/// <returns>Card element</returns>
		function CreatePollCard(message)
		{
			const poll = Owls.Store.ParsePoll(message);

			if (!poll)
			{
				return Element("span", { className: "unsent-text", text: T("chat.pollUnavailable") });
			}

			const me = Owls.Store.state.me.number;
			const votes = Array.isArray(message.votes) ? message.votes : [];
			const mine = new Set((votes.find((vote) => vote.number === me) || { options: [] }).options);
			const canVote = message.id !== undefined && !Owls.Store.IsInFlight(message) && !composer.hidden;

			const rows = poll.options.map((option, index) =>
			{
				const voters = votes.filter((vote) => vote.options.includes(index)).map((vote) => vote.number);
				const share = votes.length > 0 ? Math.round((voters.length / votes.length) * 100) : 0;
				const isChosen = mine.has(index);
				const mark = Element("span", { className: "poll-mark" });
				mark.innerHTML = poll.multiple ? (isChosen ? Owls.Icons.boxOn : Owls.Icons.box) : (isChosen ? Owls.Icons.radioOn : Owls.Icons.radio);

				const bar = Element("span", { className: "poll-bar-fill" });
				bar.style.width = `${share}%`;

				const names = voters.map(Owls.Store.GetDisplayName);
				const row = Element("button", { className: `poll-option${isChosen ? " is-chosen" : ""}` },
				[
					Element("span", { className: "poll-option-head" }, [mark, Element("span", { className: "poll-option-text", text: option }), Element("span", { className: "poll-count", text: String(voters.length) })]),
					Element("span", { className: "poll-bar-track" }, [bar]),
					names.length > 0 ? Element("span", { className: "poll-voters", text: names.length > 3 ? T("common.listAndMore", { list: names.slice(0, 3).join(T("common.listSeparator")), count: names.length - 3 }) : names.join(T("common.listSeparator")) }) : null,
				]);

				row.disabled = !canVote;
				row.addEventListener("click", (event) =>
				{
					event.stopPropagation();

					// One answer: tapping it again takes the vote back. Several: each tap ticks or unticks one.
					const next = new Set(poll.multiple ? mine : []);

					if (mine.has(index))
					{
						next.delete(index);
					}
					else
					{
						next.add(index);
					}

					Vote(message.id, [...next].sort((first, second) => first - second));
				});
				return row;
			});

			return Element("div", { className: "poll-card" },
			[
				Element("span", { className: "poll-question", text: poll.question }),
				Element("span", { className: "poll-hint", text: poll.multiple ? T("chat.pollHintMultiple") : T("chat.pollHintSingle") }),
				...rows,
				Element("span", { className: "poll-total", text: T("chat.pollVotes", { count: votes.length }) }),
			]);
		}

		/// <summary>
		/// Build the parcel an owl carries: its Galleons, and whether they wait, were collected or went back.
		/// The recipient collects them from here once the owl has landed. Neither side is told who the other is.
		/// </summary>
		/// <param name="message">Message record, or a pending owl</param>
		/// <param name="isMine">Whether the player sent it</param>
		/// <param name="isPending">Whether it is still on its way to the server</param>
		/// <returns>Card element, or null when the owl carries no parcel</returns>
		function CreateParcelCard(message, isMine, isPending)
		{
			const parcel = isPending ? (message.parcel ? { ...message.parcel.display, status: "sending" } : null) : message.parcel;

			if (!parcel)
			{
				return null;
			}

			const icon = Element("span", { className: "parcel-icon" });
			const items = parcel.items || [];
			icon.innerHTML = items.length > 0 ? Owls.Icons.parcel : Owls.Icons.coins;
			const lines = [];

			if (parcel.galleons > 0)
			{
				lines.push(Element("span", { className: "parcel-amount", text: T("parcel.galleons", { count: parcel.galleons }) }));
			}

			for (const item of items)
			{
				lines.push(Element("span", { className: "parcel-item", text: T("parcel.itemLine", { label: item.label, count: item.amount }) }));
			}

			const parts = [icon, Element("span", { className: "parcel-contents" }, lines)];

			if (parcel.status === "waiting" && !isMine && !Owls.Store.IsInFlight(message) && !composer.hidden)
			{
				const collect = Element("button", { className: "parcel-collect", text: T("parcel.collect") });
				collect.addEventListener("click", async (event) =>
				{
					// The bubble's own click selects it.
					event.stopPropagation();
					collect.disabled = true;
					collect.textContent = T("parcel.collecting");
					const result = await Owls.Bridge.Request("parcels.collect", { chatId, messageId: message.id });
					ShowError(result.ok ? "" : result.error);

					if (result.ok)
					{
						Owls.Store.SetParcel(chatId, message.id, result.data.parcel);
						return;
					}

					collect.disabled = false;
					collect.textContent = T("parcel.collect");
				});
				parts.push(collect);
			}
			else if (parcel.status !== "sending")
			{
				parts.push(Element("span", { className: "parcel-status", text: T(`parcel.status.${parcel.status}`) }));
			}

			return Element("div", { className: `parcel-card is-${parcel.status}` }, parts);
		}

		/// <summary>
		/// Cast, change or take back the player's vote in a poll.
		/// </summary>
		/// <param name="messageId">Poll message ID</param>
		/// <param name="options">Indexes of the chosen answers; empty takes the vote back</param>
		async function Vote(messageId, options)
		{
			const result = await Owls.Bridge.Request("polls.vote", { chatId, messageId, options });
			ShowError(result.ok ? "" : result.error);

			if (result.ok)
			{
				Owls.Store.SetPollVotes(chatId, messageId, result.data.votes);
			}
		}

		/// <summary>
		/// Send the poll written in the poll bar.
		/// </summary>
		async function SendPoll()
		{
			const options = [...pollOptions.children].map((field) => field.value.trim()).filter((option) => option.length > 0);
			pollSend.disabled = true;
			const result = await Owls.Bridge.Request("messages.sendPoll", { chatId, question: pollQuestion.value, options, multiple: pollMultiple.classList.contains("is-on") });
			pollSend.disabled = false;

			if (!result.ok)
			{
				pollError.textContent = result.error;
				return;
			}

			ShowBar(null);
			ResetPoll();
			Owls.Store.SetServerTime(result.data.serverNow);
			Owls.Store.AddMessage(result.data.message);
			PlaySent();
			lastReadSent = Math.max(lastReadSent, result.data.message.id);
			body.scrollTop = body.scrollHeight;
		}

		pollSend.addEventListener("click", SendPoll);

		/// <summary>
		/// The quote shown at the top of a reply's bubble. Tapping it jumps to the answered owl.
		/// </summary>
		/// <param name="quote">{ id, sender, kind, body, unsent }</param>
		/// <returns>Quote element</returns>
		function CreateQuote(quote)
		{
			const name = Element("span", { className: "quote-name", text: quote.sender ? Owls.Store.GetDisplayName(quote.sender) : T("chat.quoteUnknown") });

			if (quote.sender)
			{
				name.style.color = Owls.Util.GetNameColour(quote.sender);
			}

			const element = Element("button", { className: "bubble-quote" }, [name, Element("span", { className: "quote-text", text: DescribeOwl(quote) })]);
			element.addEventListener("click", (event) =>
			{
				event.stopPropagation();
				JumpTo(quote.id);
			});
			return element;
		}

		/// <summary>
		/// Whether an owl of the player's own has been read: by the other owl of a one-to-one chat,
		/// or by every member of a bulk owl who shares read receipts.
		/// </summary>
		/// <param name="message">Own message</param>
		/// <returns>True when read</returns>
		function IsReadByOthers(message)
		{
			const reads = Owls.Store.state.reads.get(chatId);
			const readBy = Owls.Store.GetReadBy(chatId, message.id);
			return !!reads && reads.size > 0 && readBy.length === reads.size;
		}

		/// <summary>
		/// Build the bubble of a message or pending owl.
		/// </summary>
		/// <param name="message">Stored message, or a pending entry (no id)</param>
		/// <param name="isGroup">Whether to label the sender</param>
		/// <param name="readLine">Text of a "Read by" line under it, or ""</param>
		/// <returns>Bubble element</returns>
		function CreateBubble(message, isGroup, readLine)
		{
			// Notes about the chat itself (someone leaving) are centred lines, not bubbles.
			if (Owls.Store.IsNote(message))
			{
				return Element("div", { className: "chat-note", text: `${Owls.Store.GetNoteText(message)} ${Owls.Util.FormatClock(message.sentAt)}` });
			}

			const isPending = message.id === undefined;
			const isMine = isPending || message.sender === Owls.Store.state.me.number;
			const isUnsent = Number(message.unsentAt) > 0;
			const classes = ["bubble", isMine ? "is-mine" : "is-theirs"];
			const timeLine = Element("span", { className: "bubble-time" });
			let timeText = Owls.Util.FormatClock(message.sentAt);
			let statusIcon = "";

			if (isPending && message.status === "pending")
			{
				classes.push("is-pending");
				timeText = T("chat.sending");
			}
			else if (isPending)
			{
				classes.push("is-failed");
				timeText = T("chat.failed", { error: message.error || T("chat.notSent") });
			}

			const isFlying = !isPending && isMine && !isUnsent && Owls.Store.IsInFlight(message);

			if (isFlying)
			{
				classes.push("is-flying");
				timeText = T("chat.inFlight");
			}
			else if (!isPending && isMine && !isUnsent && Owls.Store.IsShared("readReceipts"))
			{
				// One tick once it has landed, two once it has been read.
				statusIcon = IsReadByOthers(message) ? "read" : "sent";
			}

			if (isUnsent)
			{
				classes.push("is-unsent");
			}

			if (message.kind === "location" && !isUnsent)
			{
				classes.push("is-location");
			}

			if (message.kind === "poll" && !isUnsent)
			{
				classes.push("is-poll");
			}

			timeLine.appendChild(Element("span", { text: timeText }));

			if (statusIcon)
			{
				const ticks = Element("span", { className: `bubble-ticks${statusIcon === "read" ? " is-read" : ""}`, title: statusIcon === "read" ? T("chat.read") : T("chat.delivered") });
				ticks.innerHTML = statusIcon === "read" ? Owls.Icons.checkDouble : Owls.Icons.check;
				timeLine.appendChild(ticks);
			}

			const sender = isGroup && !isMine ? Element("span", { className: "bubble-sender", text: Owls.Store.GetDisplayName(message.sender) }) : null;

			if (sender)
			{
				sender.style.color = Owls.Util.GetNameColour(message.sender);
			}

			const content = isUnsent
				? Element("span", { className: "unsent-text", text: isMine ? T("message.unsent.you") : T("message.unsent") })
				: message.kind === "location" ? CreateLocationCard(message, isMine) : message.kind === "poll" ? CreatePollCard(message) : Element("span", { text: message.body });

			let forwarded = null;

			if (message.forwarded && !isUnsent)
			{
				forwarded = Element("span", { className: "bubble-forwarded" });
				forwarded.innerHTML = Owls.Icons.forward;
				forwarded.appendChild(Element("span", { text: T("chat.forwarded") }));
			}

			const bubble = Element("div", { className: classes.join(" ") },
			[
				sender,
				forwarded,
				message.replyTo && !isUnsent ? CreateQuote(message.replyTo) : null,
				content,
				CreateParcelCard(message, isMine, isPending),
				timeLine,
			]);

			if (isPending && message.status === "failed")
			{
				bubble.addEventListener("click", () => Retry(message));
			}
			else if (!isPending)
			{
				bubble.dataset.messageId = String(message.id);
				bubble.classList.toggle("is-selected", message.id === selectedId);
				bubble.addEventListener("click", () =>
				{
					// Selecting text inside a bubble should not also open its actions.
					if (String(window.getSelection() || "").length > 0)
					{
						return;
					}

					Select(selectedId === message.id ? 0 : message.id);
				});
			}

			if (!readLine)
			{
				return bubble;
			}

			return Element("div", { className: "bubble-group is-mine" }, [bubble, Element("span", { className: "read-line", text: readLine })]);
		}

		/// <summary>
		/// The "Read by" line under the player's newest owl in a bulk owl.
		/// </summary>
		/// <param name="chat">Chat summary</param>
		/// <param name="list">Loaded messages</param>
		/// <returns>{ messageId, text } or null</returns>
		function GetReadLine(chat, list)
		{
			if (!chat || chat.kind !== "group" || !Owls.Store.IsShared("readReceipts"))
			{
				return null;
			}

			const mine = [...list].reverse().find((message) => message.sender === Owls.Store.state.me.number && !Owls.Store.IsNote(message) && !(Number(message.unsentAt) > 0));

			if (!mine || Owls.Store.IsInFlight(mine))
			{
				return null;
			}

			const names = Owls.Store.GetReadBy(chatId, mine.id).map(Owls.Store.GetDisplayName);

			if (names.length === 0)
			{
				return null;
			}

			return { messageId: mine.id, text: T("chat.readBy", { names: names.length > 3 ? T("common.listAndMore", { list: names.slice(0, 3).join(T("common.listSeparator")), count: names.length - 3 }) : names.join(T("common.listSeparator")) }) };
		}

		/// <summary>
		/// Redraw the history, keeping the reader's place.
		/// </summary>
		/// <param name="mode">"bottom" to follow new messages if near the bottom, "keep" to hold the position after loading older ones</param>
		function RenderMessages(mode)
		{
			const chat = GetChat();
			const history = Owls.Store.GetHistory(chatId);
			const distanceFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight;
			const previousHeight = body.scrollHeight;
			const readLine = GetReadLine(chat, history.messages);
			const children = [];

			if (history.hasMore)
			{
				children.push(Element("button", { className: "load-older", text: isLoadingOlder ? T("chat.loading") : T("chat.loadOlder"), on: { click: LoadOlder } }));
			}

			if (!history.isLoaded)
			{
				children.push(Widgets.EmptyState(T("chat.fetching")));
			}
			else if (history.messages.length === 0 && history.pending.length === 0)
			{
				children.push(Widgets.EmptyState(T("chat.empty")));
			}

			let lastDay = 0;

			for (const message of [...history.messages, ...history.pending])
			{
				const day = Owls.Util.GetDayStart(message.sentAt);

				if (day !== lastDay)
				{
					lastDay = day;
					children.push(Element("div", { className: "day-divider", text: Owls.Util.FormatDay(message.sentAt) }));
				}

				children.push(CreateBubble(message, chat && chat.kind === "group", readLine && readLine.messageId === message.id ? readLine.text : ""));
			}

			messages.replaceChildren(...children);
			ScheduleLanding(history.messages);

			// The selected owl may have been deleted or unsent meanwhile.
			if (selectedId > 0 && !FindMessage(selectedId))
			{
				Select(0);
			}

			if (mode === "keep")
			{
				body.scrollTop = body.scrollHeight - previousHeight + body.scrollTop;
			}
			else if (isFirstRender || distanceFromBottom < stickToBottomPx)
			{
				body.scrollTop = body.scrollHeight;
			}

			if (history.isLoaded)
			{
				isFirstRender = false;
			}
		}

		/// <summary>
		/// Redraw once the next of our own in-flight owls lands, so its "In flight" turns into a time.
		/// </summary>
		/// <param name="list">Loaded messages</param>
		function ScheduleLanding(list)
		{
			clearTimeout(landingTimer);
			landingTimer = null;

			const next = list.filter((message) => message.sender === Owls.Store.state.me.number && Owls.Store.IsInFlight(message)).reduce((soonest, message) => Math.min(soonest, Number(message.deliverAt)), Infinity);

			if (Number.isFinite(next))
			{
				landingTimer = setTimeout(() => RenderMessages("bottom"), Math.max(250, next - Owls.Store.GetServerNow() + 100));
			}
		}

		/// <summary>
		/// Tell the server the newest message has been seen, once per new message.
		/// </summary>
		function MarkRead()
		{
			const history = Owls.Store.GetHistory(chatId);
			const chat = GetChat();
			const newest = history.messages.length > 0 ? history.messages[history.messages.length - 1].id : (chat && chat.lastMessage ? chat.lastMessage.id : 0);

			Owls.Store.SetUnread(chatId, 0);

			if (newest > lastReadSent)
			{
				lastReadSent = newest;
				Owls.Bridge.Request("chats.read", { chatId, messageId: newest });
			}
		}

		/// <summary>
		/// Fetch a page of history from the server.
		/// </summary>
		/// <param name="beforeId">Oldest loaded message ID, or 0 for the newest page</param>
		/// <returns>Promise resolving when the page is stored</returns>
		async function LoadPage(beforeId)
		{
			const result = await Owls.Bridge.Request("chats.history", { chatId, beforeId });

			if (!result.ok)
			{
				messages.replaceChildren(Widgets.EmptyState(result.error));
				return;
			}

			Owls.Store.SetServerTime(result.data.serverNow);

			Owls.Store.ApplyHistoryPage(result.data);
		}

		/// <summary>
		/// Load the page before the oldest loaded message.
		/// </summary>
		async function LoadOlder()
		{
			const history = Owls.Store.GetHistory(chatId);

			if (isLoadingOlder || history.messages.length === 0)
			{
				return;
			}

			isLoadingOlder = true;
			RenderMessages("keep");
			await LoadPage(history.messages[0].id);
			isLoadingOlder = false;
			RenderMessages("keep");
		}

		// ========================
		// Sending
		// ========================

		/// <summary>
		/// The sound of an owl taking off, once the server has it, if this chat is still the one on screen.
		/// </summary>
		function PlaySent()
		{
			if (Owls.App.IsOpen() && Owls.App.GetVisibleChatId() === chatId)
			{
				Owls.Effects.Play("messageSent");
			}
		}

		/// <summary>
		/// Deliver one owl, showing it as pending until the server confirms it.
		/// </summary>
		/// <param name="text">Message text</param>
		/// <param name="quote">Quote of the owl it answers, or null</param>
		/// <param name="parcel">{ request, display } of what the owl carries; null for nothing</param>
		async function Deliver(text, quote, parcel = null)
		{
			const clientKey = Owls.Util.NewKey();
			Owls.Store.AddPending(chatId, clientKey, text, quote, parcel);
			body.scrollTop = body.scrollHeight;

			const result = await Owls.Bridge.Request("messages.send", { chatId, body: text, clientKey, replyToId: quote ? quote.id : 0, parcel: parcel ? parcel.request : null });

			if (!result.ok)
			{
				Owls.Store.FailPending(chatId, clientKey, result.error);
				return;
			}

			Owls.Store.SetServerTime(result.data.serverNow);
			Owls.Store.RemovePending(chatId, clientKey);
			Owls.Store.AddMessage(result.data.message);
			PlaySent();
			lastReadSent = Math.max(lastReadSent, result.data.message.id);
		}

		/// <summary>
		/// Send whatever is in the composer, as a reply when one is being written.
		/// </summary>
		function Send()
		{
			const text = input.value.trim();

			if (text.length === 0)
			{
				return;
			}

			const quote = replyTo;
			const parcel = GetParcel();
			input.value = "";
			Owls.Store.SetDraft(chatId, "");
			emojiPicker.Hide();
			emojiButton.classList.remove("is-active");
			SetReply(null);
			ClearParcel();
			ShowAttachMenu(false);
			UpdateComposer();
			Deliver(text.slice(0, maxLength), quote, parcel);
			input.focus();
		}

		/// <summary>
		/// Resend an owl that failed to deliver.
		/// </summary>
		/// <param name="pending">Failed pending entry</param>
		function Retry(pending)
		{
			Owls.Store.RemovePending(chatId, pending.clientKey);
			Deliver(pending.body, pending.replyTo || null, pending.parcel || null);
		}

		/// <summary>
		/// Send where the player stands. The server reads the position itself; the page only names the chat.
		/// </summary>
		async function SendLocation()
		{
			locationConfirm.disabled = true;
			const result = await Owls.Bridge.Request("messages.sendLocation", { chatId });
			locationConfirm.disabled = false;

			if (!result.ok)
			{
				locationError.textContent = result.error;
				return;
			}

			ShowBar(null);
			Owls.Store.SetServerTime(result.data.serverNow);
			Owls.Store.AddMessage(result.data.message);
			PlaySent();
			lastReadSent = Math.max(lastReadSent, result.data.message.id);
			body.scrollTop = body.scrollHeight;
		}

		locationConfirm.addEventListener("click", SendLocation);

		/// <summary>
		/// Let the others see that the player is typing, at most once every few seconds and only while sharing typing indicators.
		/// </summary>
		function PingTyping()
		{
			const now = Date.now();

			if (input.value.trim().length === 0 || now - lastTypingPing < typingPingMs || !Owls.Store.IsShared("typingIndicators"))
			{
				return;
			}

			lastTypingPing = now;
			Owls.Bridge.Request("chats.typing", { chatId });
		}

		/// <summary>
		/// Put text at the composer's caret, replacing any selection.
		/// </summary>
		/// <param name="text">Text to insert (e.g. an emoji)</param>
		function InsertText(text)
		{
			const start = input.selectionStart ?? input.value.length;
			const end = input.selectionEnd ?? start;

			// Never let an emoji push the owl past its length limit; maxlength only stops typing, not script edits.
			if (input.value.length - (end - start) + text.length > maxLength)
			{
				return;
			}

			input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
			input.selectionStart = input.selectionEnd = start + text.length;
			input.focus();
			UpdateComposer();
			Owls.Store.SetDraft(chatId, input.value);
			Owls.Effects.Play("keyTap");
			PingTyping();
		}

		/// <summary>
		/// Open or close the emoji picker.
		/// </summary>
		function ToggleEmoji()
		{
			ShowAttachMenu(false);
			emojiPicker.Toggle();
			emojiButton.classList.toggle("is-active", emojiPicker.IsOpen());
			input.focus();
		}

		/// <summary>
		/// Save the other owl of this direct chat as a contact.
		/// </summary>
		async function SaveUnknown()
		{
			saveButton.disabled = true;
			const result = await Owls.Bridge.Request("contacts.saveFromChat", { chatId, name: saveNameInput.value });
			saveButton.disabled = false;

			if (!result.ok)
			{
				saveNameInput.value = "";
				saveNameInput.placeholder = result.error;
				return;
			}

			Owls.Store.UpsertContact(result.data.contact);
		}

		/// <summary>
		/// Grow the composer with its text and show the counter near the limit.
		/// </summary>
		function UpdateComposer()
		{
			// scrollHeight excludes the border, so add it back or the box overflows by a pixel and grows a scrollbar.
			input.style.height = "auto";
			input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;

			// Only scroll once the box has hit its maximum height; before that, a scrollbar would just be noise.
			input.style.overflowY = input.scrollHeight > input.clientHeight ? "auto" : "hidden";
			sendButton.disabled = input.value.trim().length === 0;

			const used = input.value.length;
			counter.textContent = `${used}/${maxLength}`;
			counter.hidden = used < maxLength * counterThreshold;
		}

		input.addEventListener("input", () =>
		{
			UpdateComposer();
			Owls.Store.SetDraft(chatId, input.value);
			PingTyping();
		});
		input.addEventListener("keydown", (event) =>
		{
			// Escape while answering drops the reply before it closes anything else.
			if (event.key === "Escape" && replyTo)
			{
				event.preventDefault();
				event.stopPropagation();
				SetReply(null);
				return;
			}

			// Enter sends; Shift+Enter starts a new line. The game's browser types no character for Enter, so the line break is added here.
			if (event.key !== "Enter")
			{
				return;
			}

			event.preventDefault();

			if (event.shiftKey)
			{
				const start = input.selectionStart;
				input.value = `${input.value.slice(0, start)}\n${input.value.slice(input.selectionEnd)}`;
				input.selectionStart = input.selectionEnd = start + 1;
				UpdateComposer();
				Owls.Store.SetDraft(chatId, input.value);
				return;
			}

			Send();
		});
		headerButton.addEventListener("click", () =>
		{
			const chat = GetChat();
			const contact = GetContact();

			if (chat && chat.kind === "group")
			{
				Owls.App.Navigate("GroupInfo", { chatId });
			}
			else if (contact)
			{
				Owls.App.Navigate("ContactDetails", { contactId: contact.id });
			}
		});
		saveButton.addEventListener("click", SaveUnknown);

		/// <summary>
		/// React to store changes that concern this chat.
		/// </summary>
		/// <param name="reason">Change reason</param>
		function Refresh(reason)
		{
			if (!GetChat())
			{
				return;
			}

			if (reason === `history:${chatId}`)
			{
				RenderMessages("bottom");

				if (Owls.App.IsOpen())
				{
					MarkRead();
				}

				return;
			}

			if (reason === `typing:${chatId}`)
			{
				RenderTyping();
				return;
			}

			if (reason === "location")
			{
				for (const button of body.querySelectorAll(".location-button"))
				{
					UpdateLocationButton(button);
				}

				return;
			}

			if (reason === "contacts" || reason === "chats" || reason === "profiles" || reason === "blocks" || reason === "senders" || reason === "retired")
			{
				RenderHeader();
			}

			if (reason === "contacts" || reason === "settings")
			{
				RenderMessages("bottom");
			}

			if (reason === "reset" || reason === "ready")
			{
				RenderHeader();
				RenderMessages("bottom");

				if (!Owls.Store.GetHistory(chatId).isLoaded)
				{
					LoadPage(0);
				}
			}
		}

		// Whatever was left unsent here last time is waiting in the composer.
		input.value = Owls.Store.GetDraft(chatId).slice(0, maxLength);

		RenderHeader();
		RenderMessages("bottom");
		UpdateComposer();

		if (Owls.Store.GetHistory(chatId).isLoaded)
		{
			MarkRead();
		}
		else
		{
			LoadPage(0);
		}

		// The composer can only be measured once the screen is in the page.
		setTimeout(() =>
		{
			UpdateComposer();
			input.focus();
		}, 0);

		/// <summary>
		/// Stop timers when the screen goes away.
		/// </summary>
		function Destroy()
		{
			clearTimeout(landingTimer);
			clearTimeout(confirmTimer);
			clearTimeout(searchTimer);
		}

		return { element, Refresh, Destroy, chatId, OnOpened: MarkRead };
	}

	return { Create };
})();
