// FranticDreamer 2026
"use strict";

// ========================
// Contact Details Screen
// ========================

/// <summary>
/// One contact: picture, editable name and picture override, a favourite star, a call button, Send Owl and delete.
/// The picture preview follows the link field as it is typed, so a broken link is obvious before saving.
/// An empty override shows the picture the owl chose for themselves; "Use Their Picture" clears a saved override.
/// With numbers.dialling on, the owl number can be edited too; two contacts can never share a number.
/// </summary>
Owls.Screens.ContactDetails = (() =>
{
	const { Element } = Owls.Util;
	const Widgets = Owls.Widgets;
	const T = Owls.Lang.T;

	/// <summary>
	/// How long the delete button waits for its confirming second tap.
	/// </summary>
	const deleteConfirmMs = 3000;

	/// <summary>
	/// Create the screen.
	/// </summary>
	/// <param name="params">{ contactId }</param>
	/// <returns>Screen instance</returns>
	function Create(params)
	{
		const config = Owls.Store.state.config;
		const initial = Owls.Store.state.contacts.get(params.contactId);

		if (!initial)
		{
			return null;
		}

		let isBusy = false;
		let deleteArmedTimer = null;
		const canEditNumber = !!config.numbersDialling;

		const favouriteButton = Widgets.IconButton(Owls.Icons.starOutline, T("details.favouriteAdd"), () => ToggleFavourite());
		const callButton = Widgets.IconButton(Owls.Icons.flame, T("call.start"), () => Call());
		const header = Widgets.Header(initial.name, [callButton, favouriteButton]);
		const avatarHolder = Element("div");
		const nameHeading = Element("div", { className: "details-name" });
		const numberLine = Element("div", { className: "field-hint" });
		const retiredLine = Element("div", { className: "field-hint", text: T("details.retired") });
		const nameInput = Element("input", { className: "text-input", attributes: { type: "text", maxlength: config.maxNameLength || 40, placeholder: T("details.namePlaceholder") } });
		const numberInput = Element("input", { className: "text-input", attributes: { type: "text", inputmode: "numeric", maxlength: 9, placeholder: "1234 5678", autocomplete: "off" } });
		const urlInput = Element("input", { className: "text-input", attributes: { type: "text", maxlength: config.maxAvatarUrlLength || 512, placeholder: "https://i.imgur.com/example.gif" } });
		const error = Element("div", { className: "form-error" });
		const saveButton = Element("button", { className: "primary-button", text: T("common.save") });
		const owlButton = Element("button", { className: "secondary-button" });
		const deleteButton = Element("button", { className: "danger-button", text: T("details.delete") });
		const clearButton = Element("button", { className: "secondary-button", text: T("details.useTheirPicture") });
		const blockButton = Element("button", { className: "danger-button" });

		owlButton.innerHTML = Owls.Icons.quill;
		owlButton.appendChild(Element("span", { text: T("details.sendOwl") }));
		nameInput.value = initial.name;
		numberInput.value = Owls.Store.FormatNumber(initial.number);
		urlInput.value = initial.avatarUrl;

		const element = Element("div", { className: "screen" },
		[
			header.element,
			Element("div", { className: "screen-body" },
			[
				Element("div", { className: "details" },
				[
					avatarHolder,
					nameHeading,
					config.numbersVisible && !canEditNumber ? numberLine : null,
					retiredLine,
					Element("label", { className: "field" }, [Element("span", { className: "field-label", text: T("details.nameLabel") }), nameInput]),
					canEditNumber ? Element("label", { className: "field" }, [Element("span", { className: "field-label", text: T("dial.numberLabel") }), numberInput]) : null,
					Element("label", { className: "field" },
					[
						Element("span", { className: "field-label", text: T("details.pictureLabel") }),
						urlInput,
						Element("span", { className: "field-hint", text: T("details.pictureHint") }),
					]),
					clearButton,
					error,
					Element("div", { className: "button-row" }, [saveButton, owlButton]),
					Element("div", { className: "button-row" }, [blockButton, deleteButton]),
				]),
			]),
		]);

		/// <summary>
		/// Redraw the avatar preview and heading from the current field values.
		/// </summary>
		function UpdatePreview()
		{
			const contact = Owls.Store.state.contacts.get(params.contactId) || initial;
			const name = nameInput.value.trim() || contact.name;
			const avatarUrl = urlInput.value.trim() || Owls.Store.GetProfileAvatarUrl(contact.number);
			avatarHolder.replaceChildren(Owls.Util.CreateAvatar(name, avatarUrl, contact.number, "is-large"));
			clearButton.hidden = !contact.avatarUrl;
			favouriteButton.innerHTML = contact.favourite ? Owls.Icons.star : Owls.Icons.starOutline;
			favouriteButton.title = contact.favourite ? T("details.favouriteRemove") : T("details.favouriteAdd");
			favouriteButton.classList.toggle("is-active", !!contact.favourite);
			blockButton.textContent = Owls.Store.IsBlocked(contact.number) ? T("common.unblock") : T("common.block");
			nameHeading.textContent = name;
			numberLine.textContent = T("owl.numbered", { number: Owls.Store.FormatNumber(contact.number) });

			// A retired owl can be renamed or deleted, and its old chat read, but not blocked or owled again.
			const isRetired = Owls.Store.IsRetired(contact.number);
			retiredLine.hidden = !isRetired;
			blockButton.hidden = isRetired;
			callButton.hidden = !Owls.Store.GetCallState(contact.number).canCall;
			owlButton.lastChild.textContent = isRetired ? T("details.readOwls") : T("details.sendOwl");
		}

		/// <summary>
		/// Disable the buttons while a request is out.
		/// </summary>
		/// <param name="busy">True while waiting</param>
		function SetBusy(busy)
		{
			isBusy = busy;
			saveButton.disabled = busy;
			owlButton.disabled = busy;
			deleteButton.disabled = busy;
			clearButton.disabled = busy;
			blockButton.disabled = busy;
		}

		/// <summary>
		/// Star or unstar this contact. Favourites are listed first in Contacts and when picking who to owl.
		/// </summary>
		async function ToggleFavourite()
		{
			const contact = Owls.Store.state.contacts.get(params.contactId);

			if (isBusy || !contact)
			{
				return;
			}

			error.textContent = "";
			SetBusy(true);
			const result = await Owls.Bridge.Request("contacts.favourite", { contactId: contact.id, favourite: !contact.favourite });
			SetBusy(false);

			if (!result.ok)
			{
				error.textContent = result.error;
				return;
			}

			Owls.Store.UpsertContact({ ...contact, favourite: result.data.favourite });
		}

		/// <summary>
		/// Call this contact.
		/// </summary>
		function Call()
		{
			error.textContent = "";
			const result = Owls.App.StartCall({ contactId: params.contactId });

			if (!result.ok)
			{
				error.textContent = result.error;
			}
		}

		/// <summary>
		/// Block or unblock this contact. Blocking does not delete the contact.
		/// </summary>
		async function ToggleBlock()
		{
			const contact = Owls.Store.state.contacts.get(params.contactId);

			if (isBusy || !contact)
			{
				return;
			}

			const block = !Owls.Store.IsBlocked(contact.number);
			error.textContent = "";
			SetBusy(true);
			const result = await Owls.Bridge.Request(block ? "blocks.add" : "blocks.remove", { number: contact.number });
			SetBusy(false);

			if (!result.ok)
			{
				error.textContent = result.error;
				return;
			}

			Owls.Store.SetBlocked(contact.number, block);
		}

		/// <summary>
		/// The digits typed in the number field.
		/// </summary>
		/// <returns>Up to 8 digits</returns>
		function GetDigits()
		{
			return numberInput.value.replace(/\D/g, "").slice(0, 8);
		}

		/// <summary>
		/// Save the edited name, picture and (when allowed) number.
		/// A number another contact already has is refused here at once; the server checks again, since the pair is a unique key there.
		/// </summary>
		async function Save()
		{
			if (isBusy)
			{
				return;
			}

			const request = { contactId: params.contactId, name: nameInput.value, avatarUrl: urlInput.value };

			if (canEditNumber)
			{
				const number = GetDigits();
				const holder = Owls.Store.state.contactsByNumber.get(number);

				if (number.length !== 8)
				{
					error.textContent = T("error.numberInvalid");
					return;
				}

				if (holder && holder.id !== params.contactId)
				{
					error.textContent = T("error.contactNumberTaken", { name: holder.name });
					return;
				}

				request.number = number;
			}

			error.textContent = "";
			SetBusy(true);
			const result = await Owls.Bridge.Request("contacts.update", request);
			SetBusy(false);

			if (!result.ok)
			{
				error.textContent = result.error;
				return;
			}

			Owls.Store.UpsertContact(result.data.contact);
			nameInput.value = result.data.contact.name;
			numberInput.value = Owls.Store.FormatNumber(result.data.contact.number);
			urlInput.value = result.data.contact.avatarUrl;
			header.title.textContent = result.data.contact.name;
			UpdatePreview();
		}

		/// <summary>
		/// Remove the saved override so the owl's own picture shows again. The saved name is kept as it is.
		/// </summary>
		async function ClearOverride()
		{
			const contact = Owls.Store.state.contacts.get(params.contactId);

			if (isBusy || !contact)
			{
				return;
			}

			error.textContent = "";
			SetBusy(true);
			const result = await Owls.Bridge.Request("contacts.update", { contactId: params.contactId, name: contact.name, avatarUrl: "" });
			SetBusy(false);

			if (!result.ok)
			{
				error.textContent = result.error;
				return;
			}

			Owls.Store.UpsertContact(result.data.contact);
			urlInput.value = "";
			UpdatePreview();
		}

		/// <summary>
		/// Delete the contact, on the second tap within a few seconds.
		/// </summary>
		async function Delete()
		{
			if (isBusy)
			{
				return;
			}

			if (deleteArmedTimer === null)
			{
				deleteButton.textContent = T("details.deleteConfirm");
				deleteArmedTimer = setTimeout(() =>
				{
					deleteArmedTimer = null;
					deleteButton.textContent = T("details.delete");
				}, deleteConfirmMs);
				return;
			}

			clearTimeout(deleteArmedTimer);
			deleteArmedTimer = null;
			SetBusy(true);
			const result = await Owls.Bridge.Request("contacts.delete", { contactId: params.contactId });
			SetBusy(false);

			if (!result.ok)
			{
				error.textContent = result.error;
				deleteButton.textContent = T("details.delete");
				return;
			}

			Owls.Store.RemoveContact(params.contactId);
			Owls.App.Back();
		}

		nameInput.addEventListener("input", UpdatePreview);
		urlInput.addEventListener("input", UpdatePreview);
		numberInput.addEventListener("input", () =>
		{
			// Written in two groups of four, like everywhere else on the phone.
			const digits = GetDigits();
			numberInput.value = digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
		});
		saveButton.addEventListener("click", Save);
		owlButton.addEventListener("click", () => Owls.App.OpenDirectChat(params.contactId));
		deleteButton.addEventListener("click", Delete);
		clearButton.addEventListener("click", ClearOverride);
		blockButton.addEventListener("click", ToggleBlock);
		for (const field of [nameInput, numberInput])
		{
			field.addEventListener("keydown", (event) =>
			{
				if (event.key === "Enter")
				{
					Save();
				}
			});
		}

		/// <summary>
		/// Leave if the contact disappeared (deleted elsewhere or a re-sync); follow their own picture changing.
		/// </summary>
		/// <param name="reason">Change reason</param>
		function Refresh(reason)
		{
			if (reason === "contacts" && !Owls.Store.state.contacts.has(params.contactId))
			{
				Owls.App.Back();
				return;
			}

			if (reason === "profiles" || reason === "contacts" || reason === "blocks" || reason === "retired")
			{
				UpdatePreview();
			}
		}

		UpdatePreview();
		return { element, Refresh, Destroy: () => clearTimeout(deleteArmedTimer) };
	}

	return { Create };
})();
