// FranticDreamer 2026
"use strict";

// ========================
// Forward Screen
// ========================

/// <summary>
/// Choose where an owl is forwarded: tick chats (one-to-one or bulk owls) and contacts not yet owled, then forward it to all of them at once.
/// Each gets a copy marked "Forwarded", sent by the player. Chats the player cannot write in are not offered.
/// </summary>
Owls.Screens.Forward = (() =>
{
	const { Element } = Owls.Util;
	const Widgets = Owls.Widgets;
	const T = Owls.Lang.T;

	/// <summary>
	/// Create the screen.
	/// </summary>
	/// <param name="params">{ chatId, messageId } of the owl to forward</param>
	/// <returns>Screen instance, or null when that owl is not loaded</returns>
	function Create(params)
	{
		const config = Owls.Store.state.config;
		const history = Owls.Store.state.histories.get(params.chatId);
		const message = history ? history.messages.find((candidate) => candidate.id === params.messageId) : null;
		const maxTargets = config.maxForwardTargets ?? 5;

		if (!message || maxTargets === 0)
		{
			return null;
		}

		const isLocation = message.kind === "location";
		const selected = new Set();
		let isBusy = false;

		const list = Element("div");
		const search = Widgets.SearchToggle(T("forward.search"), () => Refresh("chats"));
		const header = Widgets.Header(T("forward.title"), [search.button]);
		const preview = Element("div", { className: "forward-preview", text: Owls.Store.GetMessageText(message).replace(/\s+/g, " ") });
		const error = Element("div", { className: "form-error" });
		const sendButton = Element("button", { className: "primary-button" });
		const footer = Element("div", { className: "picker-footer" }, [preview, error, sendButton]);
		const element = Element("div", { className: "screen" }, [header.element, search.row, Element("div", { className: "screen-body" }, [list]), footer]);

		sendButton.innerHTML = Owls.Icons.forward;
		sendButton.appendChild(Element("span"));

		/// <summary>
		/// Whether a chat can take the copy: the player can write there, and an official sender only takes written owls.
		/// </summary>
		/// <param name="chat">Chat summary</param>
		/// <returns>True when offered</returns>
		function CanTake(chat)
		{
			if (chat.id === params.chatId || !Owls.Store.GetWriteState(chat).canWrite)
			{
				return false;
			}

			const other = chat.kind === "direct" ? Owls.Store.GetOtherMember(chat) : "";
			return !(other && (Owls.Store.IsBlocked(other) || (isLocation && Owls.Store.GetSender(other))));
		}

		/// <summary>
		/// Update the title count and the button.
		/// </summary>
		function UpdateFooter()
		{
			header.title.textContent = selected.size > 0 ? T("picker.titleCount", { title: T("forward.title"), count: selected.size }) : T("forward.title");
			sendButton.lastChild.textContent = T("forward.send");
			sendButton.disabled = isBusy || selected.size === 0;
		}

		/// <summary>
		/// Tick or untick one target.
		/// </summary>
		/// <param name="key">"chat:ID" or "contact:ID"</param>
		function Toggle(key)
		{
			error.textContent = "";

			if (selected.has(key))
			{
				selected.delete(key);
			}
			else if (selected.size >= maxTargets)
			{
				error.textContent = T("error.forwardTooMany", { count: maxTargets });
				return;
			}
			else
			{
				selected.add(key);
			}

			Refresh("chats");
		}

		/// <summary>
		/// Build the row of one chat.
		/// </summary>
		/// <param name="chat">Chat summary</param>
		/// <returns>Row element</returns>
		function CreateChatRow(chat)
		{
			const key = `chat:${chat.id}`;
			const isSelected = selected.has(key);
			const check = Element("span", { className: "check" });
			check.innerHTML = isSelected ? Owls.Icons.check : "";

			return Element("button", { className: `list-row${isSelected ? " is-selected" : ""}`, on: { click: () => Toggle(key) } },
			[
				Owls.Store.CreateChatAvatar(chat),
				Element("span", { className: "row-text" }, [Element("span", { className: "row-title", text: Owls.Store.GetChatTitle(chat) })]),
				check,
			]);
		}

		/// <summary>
		/// Forward the owl to every ticked target, then open the chat it went to (or go back, when it went to several).
		/// </summary>
		async function Send()
		{
			if (isBusy || selected.size === 0)
			{
				return;
			}

			const chatIds = [...selected].filter((key) => key.startsWith("chat:")).map((key) => Number(key.slice(5)));
			const contactIds = [...selected].filter((key) => key.startsWith("contact:")).map((key) => Number(key.slice(8)));

			isBusy = true;
			error.textContent = "";
			UpdateFooter();
			const result = await Owls.Bridge.Request("messages.forward", { chatId: params.chatId, messageId: params.messageId, chatIds, contactIds });
			isBusy = false;
			UpdateFooter();

			if (!result.ok)
			{
				error.textContent = result.error;
				return;
			}

			Owls.Store.SetServerTime(result.data.serverNow);

			for (const chat of result.data.chats || [])
			{
				Owls.Store.UpsertChat(chat);
			}

			for (const copy of result.data.messages || [])
			{
				Owls.Store.AddMessage(copy);
			}

			const failures = result.data.failures || [];

			// Some targets refused it: say so here, and leave the ticks of the ones that did get it off.
			if (failures.length > 0)
			{
				const failed = new Set(failures.map((failure) => (failure.contactId > 0 ? `contact:${failure.contactId}` : `chat:${failure.chatId}`)));

				for (const key of [...selected])
				{
					if (!failed.has(key))
					{
						selected.delete(key);
					}
				}

				error.textContent = T("forward.partial", { error: T(String(failures[0].errorKey || "error.sendFailed")) });
				Refresh("chats");
				return;
			}

			const copies = result.data.messages || [];

			if (copies.length === 1)
			{
				Owls.App.ReplaceUntil("Owls", "Chat", { chatId: copies[0].chatId });
				return;
			}

			Owls.App.Back();
		}

		sendButton.addEventListener("click", Send);

		/// <summary>
		/// Rebuild the list: chats first, then contacts the player has no chat with yet.
		/// </summary>
		/// <param name="reason">Change reason from the store</param>
		function Refresh(reason)
		{
			if (reason !== "chats" && reason !== "contacts" && reason !== "profiles" && reason !== "blocks" && reason !== "retired" && reason !== "senders" && reason !== "reset" && reason !== "ready")
			{
				return;
			}

			const query = search.GetQuery();
			const chats = Owls.Store.GetSortedChats().filter((chat) => CanTake(chat) && Owls.Util.Matches(Owls.Store.GetChatTitle(chat), query));
			const contacts = Owls.Store.GetSortedContacts(query).filter((contact) => !Owls.Store.FindDirectChat(contact.number) && !Owls.Store.GetSender(contact.number) && !Owls.Store.IsRetired(contact.number) && !Owls.Store.IsBlocked(contact.number));
			const rows = [];

			if (chats.length > 0)
			{
				rows.push(Element("div", { className: "section-letter", text: T("forward.chats") }), ...chats.map(CreateChatRow));
			}

			if (contacts.length > 0)
			{
				rows.push(Element("div", { className: "section-letter", text: T("forward.contacts") }));
				rows.push(...contacts.map((contact) => Widgets.ContactRow(contact, () => Toggle(`contact:${contact.id}`), { isSelectable: true, isSelected: selected.has(`contact:${contact.id}`) })));
			}

			list.replaceChildren(...(rows.length > 0 ? rows : [Widgets.EmptyState(query ? T("owls.noMatch") : T("forward.nowhere"))]));
			UpdateFooter();
		}

		Refresh("chats");
		return { element, Refresh, Destroy: () => {} };
	}

	return { Create };
})();
