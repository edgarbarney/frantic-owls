// FranticDreamer 2026
"use strict";

// ========================
// Contact Picker Screen
// ========================

/// <summary>
/// Choose who a new owl goes to.
/// "single" mode: tap one contact to open (or create) your one chat with them; a "Bulk Owl" row leads to "bulk" mode.
/// "bulk" mode: tick several contacts, optionally name the group, and create a group chat.
/// "add" mode: tick contacts to add to an existing bulk owl (its admins only); members already in it are not offered.
/// "call" mode: tap one contact to call them; official senders and owls that no longer fly are not offered.
/// With numbers.dialling on, "single" and "call" mode also lead to typing a number in.
/// </summary>
Owls.Screens.ContactPicker = (() =>
{
	const { Element } = Owls.Util;
	const Widgets = Owls.Widgets;
	const T = Owls.Lang.T;

	/// <summary>
	/// Create the screen.
	/// </summary>
	/// <param name="params">{ mode: "single" | "bulk" | "add" | "call", chatId (add mode) }</param>
	/// <returns>Screen instance</returns>
	function Create(params)
	{
		const isAdding = params.mode === "add";
		const isBulk = params.mode === "bulk" || isAdding;
		const isCalling = params.mode === "call";
		const config = Owls.Store.state.config;
		const targetChat = isAdding ? Owls.Store.state.chats.get(params.chatId) : null;

		if (isAdding && !targetChat)
		{
			return null;
		}

		const maxOthers = isAdding ? Math.max(0, (config.maxGroupMembers || 12) - targetChat.members.length) : Math.max(2, (config.maxGroupMembers || 12) - 1);
		const minimum = isAdding ? 1 : 2;
		const pickerTitle = isAdding ? T("picker.addTitle") : T("picker.bulkTitle");
		const selected = new Set();
		let isBusy = false;

		const list = Element("div");
		const search = Widgets.SearchToggle(T("contacts.search"), () => Refresh("contacts"));
		const header = Widgets.Header(isBulk ? pickerTitle : isCalling ? T("calls.newCall") : T("owls.sendNew"), [search.button]);
		const error = Element("div", { className: "form-error" });
		const titleInput = Element("input", { className: "text-input", attributes: { type: "text", maxlength: config.maxGroupTitleLength || 40, placeholder: T("picker.groupNamePlaceholder") } });
		const createButton = Element("button", { className: "primary-button", text: isAdding ? T("picker.addButton") : T("picker.createButton") });
		const footer = isBulk ? Element("div", { className: "picker-footer" }, [isAdding ? null : titleInput, error, createButton]) : null;
		const singleError = isBulk ? null : Element("div", { className: "form-error" });

		if (singleError)
		{
			singleError.style.padding = "0 1rem";
		}

		const element = Element("div", { className: "screen" }, [header.element, search.row, singleError, Element("div", { className: "screen-body" }, [list]), footer]);

		/// <summary>
		/// Update the bulk mode's counter and button state.
		/// </summary>
		function UpdateFooter()
		{
			if (!isBulk)
			{
				return;
			}

			header.title.textContent = selected.size > 0 ? T("picker.titleCount", { title: pickerTitle, count: selected.size }) : pickerTitle;
			createButton.disabled = isBusy || selected.size < minimum;
		}

		/// <summary>
		/// Tick or untick a contact in bulk mode.
		/// </summary>
		/// <param name="contactId">Contact ID</param>
		function Toggle(contactId)
		{
			error.textContent = "";

			if (selected.has(contactId))
			{
				selected.delete(contactId);
			}
			else if (selected.size >= maxOthers)
			{
				error.textContent = isAdding ? (maxOthers === 0 ? T("error.bulkFull") : T("picker.roomLeft", { count: maxOthers })) : T("error.bulkTooMany", { count: maxOthers });
				return;
			}
			else
			{
				selected.add(contactId);
			}

			Refresh("contacts");
		}

		/// <summary>
		/// Create the group chat from the ticked contacts and open it.
		/// </summary>
		async function CreateGroup()
		{
			if (isBusy || selected.size < minimum)
			{
				return;
			}

			isBusy = true;
			error.textContent = "";
			UpdateFooter();

			if (isAdding)
			{
				const added = await Owls.Bridge.Request("groups.addMembers", { chatId: targetChat.id, contactIds: [...selected] });
				isBusy = false;
				UpdateFooter();

				if (!added.ok)
				{
					error.textContent = added.error;
					return;
				}

				Owls.App.Back();
				return;
			}

			const result = await Owls.Bridge.Request("chats.createGroup", { contactIds: [...selected], title: titleInput.value });

			isBusy = false;
			UpdateFooter();

			if (!result.ok)
			{
				error.textContent = result.error;
				return;
			}

			Owls.Store.UpsertChat(result.data.chat);
			Owls.App.ReplaceUntil("Owls", "Chat", { chatId: result.data.chat.id });
		}

		/// <summary>
		/// Build a row above the contacts that leads somewhere else (Bulk Owl, typing a number in).
		/// </summary>
		/// <param name="icon">Icon markup</param>
		/// <param name="title">Row title</param>
		/// <param name="hint">Line under the title</param>
		/// <param name="onClick">Click handler</param>
		/// <returns>Row element</returns>
		function CreateShortcutRow(icon, title, hint, onClick)
		{
			const holder = Element("span", { className: "avatar" });
			holder.style.background = "var(--ink-raised)";
			holder.style.color = "var(--gold)";
			holder.innerHTML = icon;

			return Element("button", { className: "list-row bulk-row", on: { click: onClick } },
			[
				holder,
				Element("span", { className: "row-text" },
				[
					Element("span", { className: "row-title", text: title }),
					Element("span", { className: "row-subtitle", text: hint }),
				]),
			]);
		}

		/// <summary>
		/// Rebuild the list.
		/// </summary>
		/// <param name="reason">Change reason from the store</param>
		function Refresh(reason)
		{
			if (reason !== "contacts" && reason !== "profiles" && reason !== "reset" && reason !== "ready" && reason !== "chats" && reason !== "retired")
			{
				return;
			}

			const query = search.GetQuery();
			const members = isAdding ? new Set((Owls.Store.state.chats.get(targetChat.id) || targetChat).members) : new Set();
			const contacts = Owls.Store.GetSortedContacts(query).filter((contact) => !members.has(contact.number) && !((isBulk || isCalling) && (Owls.Store.GetSender(contact.number) || Owls.Store.IsRetired(contact.number))));
			const rows = [];

			// Drop ticks for contacts that were deleted meanwhile.
			for (const contactId of selected)
			{
				if (!Owls.Store.state.contacts.has(contactId))
				{
					selected.delete(contactId);
				}
			}

			if (!isBulk && !isCalling)
			{
				rows.push(CreateShortcutRow(Owls.Icons.group, T("picker.bulkTitle"), T("picker.bulkHint"), () => Owls.App.Navigate("ContactPicker", { mode: "bulk" })));
			}

			if (!isBulk && config.numbersDialling)
			{
				rows.push(CreateShortcutRow(Owls.Icons.dial, isCalling ? T("dial.callTitle") : T("dial.owlTitle"), T("picker.dialHint"), () => Owls.App.Navigate("Dial", { mode: isCalling ? "call" : "owl" })));
			}

			if (contacts.length === 0)
			{
				rows.push(Widgets.EmptyState(query ? T("contacts.noMatch") : isAdding ? T("picker.everyoneHere") : T("contacts.empty")));
			}
			else
			{
				rows.push(Widgets.GroupedContactList(contacts, (contact) =>
				{
					if (isBulk)
					{
						return Widgets.ContactRow(contact, () => Toggle(contact.id), { isSelectable: true, isSelected: selected.has(contact.id) });
					}

					// Hanging up returns to the call log rather than to this picker.
					if (isCalling)
					{
						return Widgets.ContactRow(contact, () =>
						{
							const result = Owls.App.StartCall({ contactId: contact.id }, "Calls");
							singleError.textContent = result.ok ? "" : result.error;
						});
					}

					return Widgets.ContactRow(contact, async () =>
					{
						singleError.textContent = "";
						const result = await Owls.App.OpenDirectChat(contact.id, true);

						if (!result.ok)
						{
							singleError.textContent = result.error;
						}
					});
				}));
			}

			list.replaceChildren(...rows);
			UpdateFooter();
		}

		createButton.addEventListener("click", CreateGroup);
		Refresh("contacts");
		return { element, Refresh, Destroy: () => {} };
	}

	return { Create };
})();
