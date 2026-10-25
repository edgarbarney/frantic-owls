// FranticDreamer 2026
"use strict";

// ========================
// Dial Screen
// ========================

/// <summary>
/// Reach an owl by typing in its number, on servers with numbers.dialling on.
/// "contact" mode saves it as a contact under a name, "owl" mode opens a chat with it and "call" mode Floo-Calls it.
/// The player's own number is shown underneath, so they know what to hand out.
/// </summary>
Owls.Screens.Dial = (() =>
{
	const { Element } = Owls.Util;
	const Widgets = Owls.Widgets;
	const T = Owls.Lang.T;

	/// <summary>
	/// Digits in an owl number.
	/// </summary>
	const numberLength = 8;

	/// <summary>
	/// Title and button text of each mode.
	/// </summary>
	const modes = Object.freeze
	({
		contact: { title: "dial.contactTitle", button: "dial.save" },
		owl: { title: "dial.owlTitle", button: "dial.owl" },
		call: { title: "dial.callTitle", button: "dial.call" },
	});

	/// <summary>
	/// Create the screen.
	/// </summary>
	/// <param name="params">{ mode: "contact" | "owl" | "call" }</param>
	/// <returns>Screen instance, or null when the server does not allow dialling</returns>
	function Create(params)
	{
		const config = Owls.Store.state.config;
		const mode = modes[params.mode] ? params.mode : "owl";

		if (!config.numbersDialling)
		{
			return null;
		}

		let isBusy = false;

		const header = Widgets.Header(T(modes[mode].title));
		const numberInput = Element("input", { className: "text-input dial-input", attributes: { type: "text", inputmode: "numeric", maxlength: numberLength + 1, placeholder: "1234 5678", autocomplete: "off" } });
		const nameInput = Element("input", { className: "text-input", attributes: { type: "text", maxlength: config.maxNameLength || 40, placeholder: T("details.namePlaceholder") } });
		const error = Element("div", { className: "form-error" });
		const submitButton = Element("button", { className: "primary-button" });
		const ownNumber = Element("div", { className: "field-hint dial-own" });

		submitButton.innerHTML = mode === "call" ? Owls.Icons.flame : mode === "owl" ? Owls.Icons.quill : Owls.Icons.userPlus;
		submitButton.appendChild(Element("span", { text: T(modes[mode].button) }));

		const element = Element("div", { className: "screen" },
		[
			header.element,
			Element("div", { className: "screen-body" },
			[
				Element("div", { className: "details" },
				[
					Element("div", { className: "field-hint", text: T("dial.intro") }),
					Element("label", { className: "field" }, [Element("span", { className: "field-label", text: T("dial.numberLabel") }), numberInput]),
					mode === "contact" ? Element("label", { className: "field" }, [Element("span", { className: "field-label", text: T("details.nameLabel") }), nameInput]) : null,
					error,
					submitButton,
					ownNumber,
				]),
			]),
		]);

		/// <summary>
		/// The digits typed so far.
		/// </summary>
		/// <returns>Up to 8 digits</returns>
		function GetDigits()
		{
			return numberInput.value.replace(/\D/g, "").slice(0, numberLength);
		}

		/// <summary>
		/// Keep the number field to digits, written in two groups of four like everywhere else on the phone.
		/// </summary>
		function FormatField()
		{
			const digits = GetDigits();
			numberInput.value = digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
			UpdateButton();
		}

		/// <summary>
		/// Allow the button once a whole number (and, for a contact, a name) is in.
		/// </summary>
		function UpdateButton()
		{
			submitButton.disabled = isBusy || GetDigits().length !== numberLength || (mode === "contact" && nameInput.value.trim().length === 0);
		}

		/// <summary>
		/// Save, owl or call the number typed in.
		/// </summary>
		async function Submit()
		{
			const number = GetDigits();

			if (isBusy || submitButton.disabled)
			{
				return;
			}

			if (number === Owls.Store.state.me.number)
			{
				error.textContent = T("error.ownNumber");
				return;
			}

			const holder = Owls.Store.state.contactsByNumber.get(number);

			if (mode === "contact" && holder)
			{
				error.textContent = T("error.contactNumberTaken", { name: holder.name });
				return;
			}

			error.textContent = "";

			// Calling goes through the call screen, which places the call and says itself how it went.
			if (mode === "call")
			{
				const result = Owls.App.StartCall({ number }, "Calls");
				error.textContent = result.ok ? "" : result.error;
				return;
			}

			isBusy = true;
			UpdateButton();

			if (mode === "owl")
			{
				const opened = await Owls.App.OpenNumberChat(number);
				isBusy = false;
				UpdateButton();
				error.textContent = opened.ok ? "" : opened.error;
				return;
			}

			const result = await Owls.Bridge.Request("contacts.addByNumber", { number, name: nameInput.value });
			isBusy = false;
			UpdateButton();

			if (!result.ok)
			{
				error.textContent = result.error;
				return;
			}

			Owls.Store.UpsertContact(result.data.contact);
			Owls.App.ReplaceUntil("Contacts", "ContactDetails", { contactId: result.data.contact.id });
		}

		numberInput.addEventListener("input", FormatField);
		nameInput.addEventListener("input", UpdateButton);
		submitButton.addEventListener("click", Submit);

		for (const field of [numberInput, nameInput])
		{
			field.addEventListener("keydown", (event) =>
			{
				if (event.key === "Enter")
				{
					event.preventDefault();
					Submit();
				}
			});
		}

		/// <summary>
		/// Show the player's own number, which may arrive after the screen was built.
		/// </summary>
		/// <param name="reason">Change reason from the store</param>
		function Refresh(reason)
		{
			if (reason !== "reset" && reason !== "ready")
			{
				return;
			}

			const me = Owls.Store.state.me.number;
			ownNumber.textContent = me ? T("dial.yourNumber", { number: Owls.Store.FormatNumber(me) }) : "";
		}

		Refresh("ready");
		UpdateButton();
		setTimeout(() => numberInput.focus(), 0);
		return { element, Refresh, Destroy: () => {} };
	}

	return { Create };
})();
