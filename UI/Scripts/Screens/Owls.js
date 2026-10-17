// FranticDreamer 2026
"use strict";

// ========================
// Owls Screen
// ========================

/// <summary>
/// The messaging app's chat list, most recent activity on top, with a search field behind the search icon
/// and a "Send New Owl" button in the bottom right corner.
/// </summary>
Owls.Screens.Owls = (() =>
{
	const { Element } = Owls.Util;
	const Widgets = Owls.Widgets;
	const T = Owls.Lang.T;

	/// <summary>
	/// Preview line of a chat's last message, prefixed with who sent it where that is not obvious.
	/// </summary>
	/// <param name="chat">Chat summary</param>
	/// <returns>Preview text</returns>
	function GetPreview(chat)
	{
		const message = chat.lastMessage;

		if (!message)
		{
			return chat.kind === "group" ? T("owls.groupCreated") : "";
		}

		if (Owls.Store.IsNote(message))
		{
			return Owls.Store.GetNoteText(message);
		}

		if (Owls.Store.IsBlocked(message.sender))
		{
			return T("owls.fromBlocked");
		}

		const body = Owls.Store.GetMessageText(message).replace(/\s+/g, " ");

		if (message.sender === Owls.Store.state.me.number)
		{
			return T("owls.previewMine", { body });
		}

		return chat.kind === "group" ? T("owls.previewGroup", { name: Owls.Store.GetDisplayName(message.sender), body }) : body;
	}

	/// <summary>
	/// Build the row of one chat.
	/// </summary>
	/// <param name="chat">Chat summary</param>
	/// <returns>Row element</returns>
	function CreateRow(chat)
	{
		const badge = chat.unread > 0 ? Element("span", { className: "unread-badge", text: chat.unread > 99 ? "99+" : chat.unread }) : null;
		const muted = Owls.Store.IsMuted(chat) ? Element("span", { className: "row-muted", title: T("chat.muted") }) : null;
		const pinned = Number(chat.pinnedAt) > 0 ? Element("span", { className: "row-muted row-pinned", title: T("owls.pinned") }) : null;

		if (muted)
		{
			muted.innerHTML = Owls.Icons.bellSlash;
		}

		if (pinned)
		{
			pinned.innerHTML = Owls.Icons.thumbtack;
		}

		const time = chat.lastMessage ? Math.max(chat.lastMessage.sentAt, chat.lastMessage.deliverAt || 0) : chat.lastActivityAt;
		const typing = Owls.Store.GetTypingText(chat.id, chat.kind === "group");

		return Element("button", { className: `list-row${pinned ? " is-pinned" : ""}`, on: { click: () => Owls.App.Navigate("Chat", { chatId: chat.id }) } },
		[
			Owls.Store.CreateChatAvatar(chat),
			Element("span", { className: "row-text" },
			[
				Element("span", { className: "row-title", text: Owls.Store.GetChatTitle(chat) }),
				Element("span", { className: `row-subtitle${typing ? " is-typing" : ""}`, text: typing || GetPreview(chat) }),
			]),
			Element("span", { className: "row-meta" }, [Element("span", { text: Owls.Util.FormatListTime(time) }), Element("span", { className: "row-badges" }, [pinned, muted, badge])]),
		]);
	}

	/// <summary>
	/// Create the screen.
	/// </summary>
	/// <returns>Screen instance</returns>
	function Create()
	{
		const list = Element("div");
		const search = Widgets.SearchToggle(T("owls.search"), () => Refresh("chats"));
		const header = Widgets.Header(T("home.owls"), [search.button]);
		const fab = Element("button", { className: "fab", on: { click: () => Owls.App.Navigate("ContactPicker", { mode: "single" }) } });
		fab.innerHTML = Owls.Icons.quill;
		fab.appendChild(Element("span", { text: T("owls.sendNew") }));

		// The list is padded at the bottom so the last chat can scroll clear of the floating button.
		list.style.paddingBottom = "4.5rem";

		const element = Element("div", { className: "screen" }, [header.element, search.row, Element("div", { className: "screen-body" }, [list]), fab]);

		/// <summary>
		/// Rebuild the list.
		/// </summary>
		/// <param name="reason">Change reason from the store</param>
		function Refresh(reason)
		{
			if (reason !== "chats" && reason !== "contacts" && reason !== "profiles" && reason !== "blocks" && reason !== "senders" && reason !== "reset" && reason !== "ready" && !String(reason).startsWith("typing:"))
			{
				return;
			}

			const query = search.GetQuery();
			const chats = Owls.Store.GetSortedChats(query);

			if (chats.length === 0)
			{
				list.replaceChildren(Widgets.EmptyState(query ? T("owls.noMatch") : T("owls.empty")));
				return;
			}

			list.replaceChildren(...chats.map(CreateRow));
		}

		Refresh("chats");
		return { element, Refresh, Destroy: () => {} };
	}

	return { Create };
})();
