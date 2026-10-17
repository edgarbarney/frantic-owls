// FranticDreamer 2026
"use strict";

// ========================
// Group Info Screen
// ========================

/// <summary>
/// A bulk owl's details: its picture, name and members, opened from the chat header.
/// Admins can rename it, change its picture, add and remove members and hand out or take back adminship; everyone can leave.
/// The server checks every one of these; the page only hides buttons a player could not use anyway.
/// </summary>
Owls.Screens.GroupInfo = (() =>
{
	const { Element } = Owls.Util;
	const Widgets = Owls.Widgets;
	const T = Owls.Lang.T;

	/// <summary>
	/// How long a "Remove" or "Leave" button waits for its confirming second tap.
	/// </summary>
	const confirmMs = 3000;

	/// <summary>
	/// Create the screen.
	/// </summary>
	/// <param name="params">{ chatId }</param>
	/// <returns>Screen instance, or null if the chat is not a known bulk owl</returns>
	function Create(params)
	{
		const chatId = params.chatId;
		const config = Owls.Store.state.config;
		const initial = Owls.Store.state.chats.get(chatId);

		if (!initial || initial.kind !== "group")
		{
			return null;
		}

		let armed = "";
		let armedTimer = null;
		let isBusy = false;

		const header = Widgets.Header(T("picker.bulkTitle"));
		const avatarHolder = Element("div");
		const nameHeading = Element("div", { className: "details-name" });
		const countLine = Element("div", { className: "field-hint" });
		const error = Element("div", { className: "form-error" });
		const titleInput = Element("input", { className: "text-input", attributes: { type: "text", maxlength: config.maxGroupTitleLength || 40, placeholder: T("group.namePlaceholder") } });
		const titleButton = Element("button", { className: "secondary-button", text: T("group.rename"), on: { click: () => Rename() } });
		const pictureInput = Element("input", { className: "text-input", attributes: { type: "text", maxlength: config.maxAvatarUrlLength || 512, placeholder: "https://i.imgur.com/example.gif" } });
		const pictureButton = Element("button", { className: "secondary-button", text: T("common.save"), on: { click: () => SavePicture() } });
		const adminSection = Element("div", { className: "details-section" },
		[
			Element("span", { className: "field-label", text: T("details.nameLabel") }),
			Element("div", { className: "profile-row" }, [titleInput, titleButton]),
			Element("span", { className: "field-label", text: T("group.pictureLabel") }),
			Element("div", { className: "profile-row" }, [pictureInput, pictureButton]),
			Element("span", { className: "field-hint", text: T("group.pictureHint") }),
		]);
		const addButton = Element("button", { className: "secondary-button", on: { click: () => Owls.App.Navigate("ContactPicker", { mode: "add", chatId }) } });
		addButton.innerHTML = Owls.Icons.userPlus;
		addButton.appendChild(Element("span", { text: T("picker.addTitle") }));
		const memberList = Element("div", { className: "member-list" });
		const leaveButton = Element("button", { className: "danger-button", text: T("group.leave"), on: { click: () => Arm("leave", Leave) } });

		titleInput.value = initial.title || "";
		pictureInput.value = initial.avatarUrl || "";

		const element = Element("div", { className: "screen" },
		[
			header.element,
			Element("div", { className: "screen-body" },
			[
				Element("div", { className: "details" },
				[
					avatarHolder,
					nameHeading,
					countLine,
					error,
					adminSection,
					Element("div", { className: "details-section" }, [Element("span", { className: "field-label", text: T("group.membersLabel") }), addButton, memberList]),
					leaveButton,
				]),
			]),
		]);

		/// <summary>
		/// The bulk owl as currently stored.
		/// </summary>
		/// <returns>Chat summary, or undefined once it is gone</returns>
		function GetChat()
		{
			return Owls.Store.state.chats.get(chatId);
		}

		/// <summary>
		/// Run an action on its second tap; the first tap only asks for it (Render shows the armed button's prompt).
		/// </summary>
		/// <param name="key">Which action is armed ("leave" or "remove:" plus an owl number)</param>
		/// <param name="Action">Function run once confirmed</param>
		function Arm(key, Action)
		{
			if (armed === key)
			{
				armed = "";
				clearTimeout(armedTimer);
				Render();
				Action();
				return;
			}

			armed = key;
			Render();
			clearTimeout(armedTimer);
			armedTimer = setTimeout(() =>
			{
				armed = "";
				Render();
			}, confirmMs);
		}

		/// <summary>
		/// Send one administration request and show its error, if any.
		/// </summary>
		/// <param name="action">Request action</param>
		/// <param name="data">Request payload (chatId is added)</param>
		/// <returns>Result</returns>
		async function Administer(action, data)
		{
			if (isBusy)
			{
				return { ok: false, error: "" };
			}

			isBusy = true;
			error.textContent = "";
			const result = await Owls.Bridge.Request(action, { chatId, ...data });
			isBusy = false;

			if (!result.ok)
			{
				error.textContent = result.error;
			}

			return result;
		}

		/// <summary>
		/// Rename the bulk owl.
		/// </summary>
		async function Rename()
		{
			const result = await Administer("groups.rename", { title: titleInput.value });

			if (result.ok)
			{
				Owls.Store.UpsertChat({ id: chatId, title: result.data.title });
			}
		}

		/// <summary>
		/// Change or clear the bulk owl's picture.
		/// </summary>
		async function SavePicture()
		{
			const result = await Administer("groups.picture", { avatarUrl: pictureInput.value });

			if (result.ok)
			{
				pictureInput.value = result.data.avatarUrl;
				Owls.Store.UpsertChat({ id: chatId, avatarUrl: result.data.avatarUrl });
			}
		}

		/// <summary>
		/// Leave the bulk owl and go back to the chat list.
		/// </summary>
		async function Leave()
		{
			const result = await Administer("chats.leave", {});

			if (result.ok)
			{
				Owls.App.Home();
				Owls.Store.RemoveChat(chatId);
				Owls.App.Navigate("Owls");
			}
		}

		/// <summary>
		/// Build the row of one member, with the admin buttons an admin may use on them.
		/// </summary>
		/// <param name="chat">Chat summary</param>
		/// <param name="number">Member owl number</param>
		/// <returns>Row element</returns>
		function CreateMemberRow(chat, number)
		{
			const me = Owls.Store.state.me.number;
			const isMe = number === me;
			const isCreator = number === chat.createdBy;
			const isMemberAdmin = (chat.admins || []).includes(number);
			const contact = Owls.Store.state.contactsByNumber.get(number);
			const name = isMe ? T("group.memberYou", { name: Owls.Store.state.me.name || T("common.you") }) : Owls.Store.GetDisplayName(number);
			const role = isCreator ? T("group.roleCreator") : isMemberAdmin ? T("group.roleAdmin") : "";
			const actions = [];

			if (Owls.Store.IsAdmin(chat) && !isMe)
			{
				if (!isCreator)
				{
					const roleButton = Element("button", { className: "secondary-button member-action", text: isMemberAdmin ? T("group.removeAdmin") : T("group.makeAdmin") });
					roleButton.addEventListener("click", (event) =>
					{
						event.stopPropagation();
						Administer("groups.setAdmin", { number, admin: !isMemberAdmin });
					});
					actions.push(roleButton);

					const removeButton = Element("button", { className: "danger-button member-action", text: armed === `remove:${number}` ? T("group.removeConfirm") : T("group.remove") });
					removeButton.addEventListener("click", (event) =>
					{
						event.stopPropagation();
						Arm(`remove:${number}`, () => Administer("groups.removeMember", { number }));
					});
					actions.push(removeButton);
				}
			}

			const badge = role ? Element("span", { className: "member-role" }) : null;

			if (badge)
			{
				badge.innerHTML = Owls.Icons.crown;
				badge.appendChild(Element("span", { text: role }));
			}

			return Element("div", { className: `list-row member-row${contact ? " is-link" : ""}`, on: { click: () => contact && Owls.App.Navigate("ContactDetails", { contactId: contact.id }) } },
			[
				Owls.Util.CreateAvatar(isMe ? Owls.Store.state.me.name : contact ? contact.name : "", Owls.Store.GetAvatarUrl(number), number, "", contact || isMe ? "" : Owls.Icons.owl),
				Element("span", { className: "row-text" }, [Element("span", { className: "row-title", text: name }), badge]),
				actions.length > 0 ? Element("span", { className: "member-actions" }, actions) : null,
			]);
		}

		/// <summary>
		/// Redraw everything from the stored chat.
		/// </summary>
		function Render()
		{
			const chat = GetChat();

			if (!chat)
			{
				return;
			}

			const isAdmin = Owls.Store.IsAdmin(chat);
			const max = config.maxGroupMembers || 12;
			avatarHolder.replaceChildren(Owls.Store.CreateChatAvatar(chat, "is-large"));
			nameHeading.textContent = Owls.Store.GetChatTitle(chat);
			countLine.textContent = isAdmin ? T("group.countAdmin", { count: chat.members.length, max }) : T("group.count", { count: chat.members.length, max });
			adminSection.hidden = !isAdmin;
			addButton.hidden = !isAdmin || chat.members.length >= max;
			leaveButton.textContent = armed === "leave" ? T("group.leaveConfirm") : T("group.leave");

			// Admins first (the creator on top), then everyone else in the order they joined.
			const ordered = [...chat.members].sort((first, second) => Number(second === chat.createdBy) - Number(first === chat.createdBy) || Number((chat.admins || []).includes(second)) - Number((chat.admins || []).includes(first)));
			memberList.replaceChildren(...ordered.map((number) => CreateMemberRow(chat, number)));
		}

		/// <summary>
		/// React to store changes.
		/// </summary>
		/// <param name="reason">Change reason</param>
		function Refresh(reason)
		{
			if (!GetChat())
			{
				return;
			}

			if (reason === "chats" || reason === "contacts" || reason === "profiles" || reason === "reset" || reason === "ready" || reason === "senders")
			{
				const chat = GetChat();

				// Keep a name or link the admin is still typing.
				if (document.activeElement !== titleInput)
				{
					titleInput.value = chat.title || "";
				}

				if (document.activeElement !== pictureInput)
				{
					pictureInput.value = chat.avatarUrl || "";
				}

				Render();
			}
		}

		titleInput.addEventListener("keydown", (event) =>
		{
			if (event.key === "Enter")
			{
				Rename();
			}
		});
		pictureInput.addEventListener("keydown", (event) =>
		{
			if (event.key === "Enter")
			{
				SavePicture();
			}
		});

		Render();
		return { element, Refresh, Destroy: () => clearTimeout(armedTimer), chatId };
	}

	return { Create };
})();
