// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};
Owls.DeskScreens = Owls.DeskScreens || {};

// ========================
// Compose Screen
// ========================

/// <summary>
/// Writing a letter, or an official letter as a system sender (the Ministry) for those allowed to.
///
/// <para>
/// NOTE: By default the player writes only the middle of the letter: the greeting ("Dear Ominis and Natsai,") follows the recipients they pick,
/// and the sign-off and their name are filled in below. The quill button turns the whole letter into one page of text, greeting and signature included,
/// so they can be reworded or left out (an unsigned letter is anonymous to its reader). Either way the server stores the finished text and nothing else.
/// </para>
///
/// <para>
/// NOTE: A letter can go to any character with an owl. Typing a name shows one list: the player's correspondents that match first, then every other character by that name the server finds.
/// A character the player already has as a correspondent is only listed as that correspondent; one saved without knowing who they are has no number on the page, so it cannot be matched and both show.
/// Answering a letter adds its writer as a recipient by the letter, not by name; the server finds who wrote it.
/// </para>
///
/// </summary>
Owls.DeskScreens.Compose = (() =>
{
	const { Element, NewKey } = Owls.Util;
	const T = Owls.Lang.T;
	const Store = Owls.MailStore;
	const Search = Owls.MailSearch;

	/// <summary>
	/// Most correspondents suggested at once; the server's names come after them.
	/// </summary>
	const maxContactSuggestions = 6;

	/// <summary>
	/// How long a button waits for its confirming second click.
	/// </summary>
	const confirmMs = 4000;

	/// <summary>
	/// How long after the last keystroke the draft is saved.
	/// </summary>
	const draftSaveDelayMs = 400;

	/// <summary>
	/// Recipient kinds a saved draft may hold. Drafts from before recipients could be anyone are dropped down to these.
	/// </summary>
	const recipientKinds = Object.freeze(["contact", "owl", "reply"]);

	/// <summary>
	/// Keep the recipients of a saved draft that this version can still send to.
	/// </summary>
	/// <param name="list">Saved recipients</param>
	/// <returns>Usable recipients</returns>
	function ReadSavedRecipients(list)
	{
		return (Array.isArray(list) ? list : []).filter((recipient) => recipient && recipientKinds.includes(recipient.kind) && (recipient.kind !== "contact" || Number(recipient.contactId) > 0) && (recipient.kind !== "owl" || /^\d{8}$/.test(String(recipient.number))));
	}

	/// <summary>
	/// Build the screen.
	/// </summary>
	/// <param name="desk">Owls.Desk, for navigation and messages</param>
	/// <param name="params">{ replyTo } with the opened letter being answered, { to } with a correspondent to write to, or { official: { number, name } } to write as that sender (all optional)</param>
	/// <returns>{ element, OnStore(reason), Destroy() }</returns>
	function Create(desk, params = {})
	{
		const replyTo = params.replyTo || null;
		const official = params.official || null;
		const draftKey = official ? `official:${official.number}` : replyTo ? `reply:${replyTo.id}` : "new";
		const config = Store.state.config;
		const maxLength = Number(config.maxLetterLength) || 4000;
		const maxRecipients = official ? Number(config.maxOfficialRecipients) || 50 : Number(config.maxRecipients) || 8;
		const signature = official ? official.name : Store.state.me.name;
		const saved = Store.LoadDraft(draftKey);

		const draft =
		{
			recipients: ReadSavedRecipients(saved && saved.recipients),
			body: saved ? String(saved.body || "") : "",
			isFull: !!(saved && saved.isFull),
			fullText: saved ? String(saved.fullText || "") : "",
			everyone: !!(official && saved && saved.everyone),
		};

		// Answering adds the letter's writer, named the way they signed (or as the official sender they are).
		if (replyTo && !draft.recipients.some((recipient) => recipient.kind === "reply"))
		{
			const label = replyTo.official ? replyTo.official.name : replyTo.excerpt && replyTo.excerpt.last ? replyTo.excerpt.last : "";
			draft.recipients.unshift({ key: `reply:${replyTo.id}`, kind: "reply", replyToId: replyTo.id, name: label });
		}

		// Writing from the correspondents adds that correspondent, unless the draft already has them.
		if (params.to && !draft.recipients.some((recipient) => recipient.key === `contact:${params.to.id}`) && draft.recipients.length < maxRecipients)
		{
			draft.recipients.push({ key: `contact:${params.to.id}`, kind: "contact", contactId: params.to.id, name: params.to.name });
		}

		let isSending = false;
		let saveTimer = null;
		let confirmTimer = null;
		let pendingConfirm = "";
		let endConfirm = null;
		let picker = null;

		const element = Element("section", { className: "compose" });
		const counter = Element("span", { className: "compose-counter" });
		const status = Element("span", { className: "compose-status" });
		const sealButton = Element("button", { className: "seal", title: T("mail.compose.send"), attributes: { "aria-label": T("mail.compose.send") }, on: { click: Send } });
		const sealHint = Element("span", { className: "seal-hint", text: T("mail.compose.seal") });

		/// <summary>
		/// The names the letter is addressed to, in order, as the greeting uses them.
		/// </summary>
		/// <returns>Names</returns>
		function GetNames()
		{
			if (draft.everyone)
			{
				return [T("mail.official.everyone")];
			}

			return draft.recipients.map((recipient) => recipient.name || T("mail.letter.noName"));
		}

		/// <summary>
		/// The letter's finished text, as it will be stored and read.
		/// </summary>
		/// <returns>Text</returns>
		function GetLetterText()
		{
			return draft.isFull ? draft.fullText : Owls.Sheet.Compose(GetNames(), draft.body, signature);
		}

		/// <summary>
		/// Save the draft a moment after the player stops typing.
		/// </summary>
		function QueueSave()
		{
			clearTimeout(saveTimer);
			saveTimer = setTimeout(SaveNow, draftSaveDelayMs);
		}

		/// <summary>
		/// Save the draft now, or forget it when nothing has been written or picked yet.
		/// </summary>
		function SaveNow()
		{
			clearTimeout(saveTimer);
			saveTimer = null;
			const isEmpty = draft.body.trim().length === 0 && (!draft.isFull || draft.fullText.trim().length === 0) && draft.recipients.every((recipient) => recipient.kind === "reply") && !draft.everyone;
			Store.SaveDraft(draftKey, isEmpty ? null : { ...draft, savedAt: Date.now() });
		}

		/// <summary>
		/// Whether the letter may be sent from where the player stands. Official letters are not tied to owl posts.
		/// </summary>
		/// <returns>True when writing is allowed</returns>
		function CanWrite()
		{
			return !!official || Store.CanWrite();
		}

		/// <summary>
		/// Show how much of the letter's length is used, and whether it may be sent.
		/// </summary>
		function UpdateCounter()
		{
			const length = GetLetterText().length;
			counter.textContent = T("mail.compose.counter", { count: length, max: maxLength });
			counter.classList.toggle("is-over", length > maxLength);
			sealButton.disabled = isSending || !CanWrite();
		}

		/// <summary>
		/// Make a button act only on a second click within a few seconds, showing what the second click will do.
		/// </summary>
		/// <param name="button">Button</param>
		/// <param name="id">Name of the action, so another button's pending click does not count</param>
		/// <param name="confirmText">Text shown while it waits</param>
		/// <returns>True when this click is the confirming one</returns>
		function Confirm(button, id, confirmText)
		{
			const isSecondClick = pendingConfirm === id;

			// One question at a time: a click on another button takes the first one down.
			if (endConfirm)
			{
				endConfirm();
			}

			if (isSecondClick)
			{
				return true;
			}

			pendingConfirm = id;

			// The question hangs under the button rather than replacing its label, so the toolbar keeps its width and the title stays centred.
			const bubble = Element("span", { className: "confirm-bubble", text: confirmText, attributes: { role: "status" } });
			button.appendChild(bubble);
			button.classList.add("is-confirming");
			endConfirm = () =>
			{
				clearTimeout(confirmTimer);
				pendingConfirm = "";
				endConfirm = null;
				bubble.remove();
				button.classList.remove("is-confirming");
			};
			confirmTimer = setTimeout(endConfirm, confirmMs);
			return false;
		}

		// ========================
		// Recipients
		// ========================

		/// <summary>
		/// Create the recipient field: the names picked so far, a text box to find more, and the suggestions under it.
		/// In template mode it is the greeting line itself ("Dear [names],"); in full mode it sits above the sheet ("To: [names]").
		/// </summary>
		/// <param name="isGreeting">True for the greeting line on the sheet</param>
		/// <returns>{ element, Render(), Focus(), Destroy() }</returns>
		function CreatePicker(isGreeting)
		{
			// The greeting's words come from the language file around {names}, so the field reads exactly like the line it becomes.
			const [before, after] = isGreeting ? T("mail.letter.salutation", { names: "\u0000" }).split("\u0000") : [T("mail.compose.to"), ""];
			const names = Element("span", { className: "picker-names" });
			const input = Element("input", { className: "picker-input", attributes: { type: "text", autocomplete: "off", spellcheck: "false", maxlength: "64" } });
			const list = Element("ul", { className: "picker-list" });
			const dropdown = Element("div", { className: "picker-dropdown" }, [list]);
			const field = Element("span", { className: "picker-field" }, [input, dropdown]);
			const pickerElement = Element("div", { className: `picker ${isGreeting ? "is-greeting" : "is-address"}`, on: { click: FocusFromLine } },
			[
				Element("span", { className: "picker-before", text: before }),
				names,
				field,
				after ? Element("span", { className: "picker-after", text: after }) : null,
			]);

			/// <summary>
			/// The server's latest answer for what is typed: { query, owls, isPending }.
			/// </summary>
			let found = { query: "", owls: [], isPending: false };
			const searcher = Search.CreateSearcher((answer) =>
			{
				found = answer;
				RenderSuggestions();
			});

			/// <summary>
			/// Clicking anywhere on the line (but not on a name, which crosses it out) puts the cursor in the text box.
			/// </summary>
			/// <param name="event">Click event</param>
			function FocusFromLine(event)
			{
				if (!event.target.closest(".picker-name, .picker-dropdown"))
				{
					input.focus();
				}
			}

			/// <summary>
			/// The suggestions for what is typed: matching correspondents, then the other characters the server found by that name.
			/// </summary>
			/// <returns>{ contacts: [recipient], owls: [recipient] }</returns>
			function GetSuggestions()
			{
				const query = input.value.trim();

				if (query.length === 0)
				{
					return { contacts: [], owls: [] };
				}

				const picked = new Set(draft.recipients.map((recipient) => recipient.key));
				const known = Store.GetKnownNumbers();
				const contacts = Store.state.contacts
					.filter((contact) => Search.Matches(contact.name, query) || Search.Matches(contact.originalName, query))
					.map((contact) => ({ key: `contact:${contact.id}`, kind: "contact", contactId: contact.id, name: contact.name, label: Store.GetContactLabel(contact) }))
					.filter((recipient) => !picked.has(recipient.key))
					.slice(0, maxContactSuggestions);
				const owls = found.query === Search.Fold(query) ? found.owls
					.filter((owl) => !known.has(owl.number))
					.map((owl) => ({ key: `owl:${owl.number}`, kind: "owl", number: owl.number, name: owl.name, label: owl.name, online: owl.online }))
					.filter((recipient) => !picked.has(recipient.key)) : [];

				return { contacts, owls };
			}

			/// <summary>
			/// Draw the suggestions.
			/// </summary>
			function RenderSuggestions()
			{
				const query = input.value.trim();
				const { contacts, owls } = GetSuggestions();
				const rows = contacts.map(CreateOption);

				if (contacts.length > 0 && owls.length > 0)
				{
					rows.push(Element("li", { className: "picker-divider", attributes: { role: "separator" } }));
				}

				rows.push(...owls.map(CreateOption));

				if (draft.recipients.length >= maxRecipients)
				{
					rows.splice(0, rows.length, Element("li", { className: "picker-none", text: T("mail.compose.recipientsFull") }));
				}
				else if (query.length === 0)
				{
					rows.push(Element("li", { className: "picker-none", text: T("mail.compose.typeName") }));
				}
				else if (found.isPending && found.query === Search.Fold(query))
				{
					rows.push(Element("li", { className: "picker-none", text: T("mail.compose.searching") }));
				}
				else if (rows.length === 0)
				{
					rows.push(Element("li", { className: "picker-none", text: T(Search.Fold(query).length < Search.minQueryLength ? "mail.compose.typeMore" : "mail.compose.noMatches") }));
				}

				list.replaceChildren(...rows);
			}

			/// <summary>
			/// One suggestion. It is picked on mousedown, before the text box loses focus and the suggestions close.
			/// </summary>
			/// <param name="recipient">Suggested recipient</param>
			/// <returns>List item</returns>
			function CreateOption(recipient)
			{
				const option = Element("li", { className: `picker-option is-${recipient.kind}` },
				[
					Element("span", { className: "picker-option-name", text: recipient.label }),
					recipient.kind === "contact" ? Element("i", { className: "fa-solid fa-address-book picker-option-mark", title: T("mail.compose.isCorrespondent") }) : null,
					recipient.kind === "owl" && recipient.online ? Element("span", { className: "picker-online", title: T("mail.compose.online") }) : null,
				]);

				option.addEventListener("mousedown", (event) =>
				{
					event.preventDefault();
					Pick(recipient);
				});

				return option;
			}

			/// <summary>
			/// Add a recipient.
			/// </summary>
			/// <param name="recipient">Suggestion picked</param>
			function Pick(recipient)
			{
				if (draft.recipients.length >= maxRecipients)
				{
					desk.ShowError(T("error.mail.tooManyRecipients", { count: maxRecipients }));
					return;
				}

				const { label, online, ...kept } = recipient;
				draft.recipients.push(kept);
				input.value = "";
				searcher.Cancel();
				found = { query: "", owls: [], isPending: false };
				OnRecipientsChanged();
				RenderSuggestions();
			}

			/// <summary>
			/// Remove a recipient.
			/// </summary>
			/// <param name="key">Recipient key</param>
			function Unpick(key)
			{
				draft.recipients = draft.recipients.filter((recipient) => recipient.key !== key);
				OnRecipientsChanged();
				RenderSuggestions();
			}

			/// <summary>
			/// Draw the names picked so far, joined the way the greeting will join them.
			/// </summary>
			function Render()
			{
				const shown = GetNames();
				let parts = [];

				// formatToParts gives the names with the language's own "and" between them; Intl throws for a locale it cannot parse.
				try
				{
					parts = shown.length > 0 ? new Intl.ListFormat(Owls.Lang.GetId(), { style: "long", type: "conjunction" }).formatToParts(shown) : [];
				}
				catch (error)
				{
					parts = shown.flatMap((name, index) => (index === 0 ? [{ type: "element", value: name }] : [{ type: "literal", value: ", " }, { type: "element", value: name }]));
				}

				let index = 0;
				names.replaceChildren(...parts.map((part) =>
				{
					if (part.type !== "element")
					{
						return Element("span", { className: "picker-literal", text: part.value });
					}

					// Writing to everyone is turned off with its own button, so its name cannot be crossed out here.
					if (draft.everyone)
					{
						return Element("span", { className: "picker-name is-everyone", text: part.value });
					}

					const recipient = draft.recipients[index++];
					return Element("button", { className: `picker-name is-${recipient.kind}`, text: part.value, title: T("mail.compose.remove"), on: { click: () => Unpick(recipient.key) } });
				}));

				field.hidden = draft.everyone;
				input.placeholder = T(draft.recipients.length === 0 ? "mail.compose.namePlaceholder" : "mail.compose.morePlaceholder");
				input.style.width = `${Math.max(6, (input.value || input.placeholder).length + 1)}ch`;
			}

			input.addEventListener("focus", () =>
			{
				RenderSuggestions();
				pickerElement.classList.add("is-open");
			});
			input.addEventListener("blur", () => pickerElement.classList.remove("is-open"));
			input.addEventListener("input", () =>
			{
				searcher.Find(input.value);
				RenderSuggestions();
				input.style.width = `${Math.max(6, (input.value || input.placeholder).length + 1)}ch`;
			});
			input.addEventListener("keydown", (event) =>
			{
				if (event.key === "Backspace" && input.value === "" && draft.recipients.length > 0)
				{
					Unpick(draft.recipients[draft.recipients.length - 1].key);
				}
				else if (event.key === "Enter")
				{
					event.preventDefault();
					const { contacts, owls } = GetSuggestions();
					const first = contacts[0] || owls[0];

					if (first)
					{
						Pick(first);
					}
				}
			});

			Render();
			return { element: pickerElement, Render, Focus: () => input.focus(), Destroy: () => searcher.Cancel() };
		}

		/// <summary>
		/// Redraw what depends on the recipients: the greeting and the counter.
		/// </summary>
		function OnRecipientsChanged()
		{
			if (picker)
			{
				picker.Render();
			}

			UpdateCounter();
			QueueSave();
		}

		// ========================
		// Layout
		// ========================

		/// <summary>
		/// Leave the composer for the screen it was opened from.
		/// </summary>
		function GoBack()
		{
			if (official)
			{
				desk.ShowOfficial();
			}
			else
			{
				desk.ShowLetters({});
			}
		}

		/// <summary>
		/// Lay the screen out for the current mode.
		/// </summary>
		function Build()
		{
			const backButton = Element("button", { className: "desk-button is-quiet", on: { click: () => { SaveNow(); GoBack(); } } },
			[
				Element("i", { className: "fa-solid fa-arrow-left", attributes: { "aria-hidden": "true" } }),
				Element("span", { text: T(official ? "mail.official.tab" : "mail.compose.back") }),
			]);
			const modeButton = Element("button", { className: `desk-button ${draft.isFull ? "is-active" : ""}`, title: T(draft.isFull ? "mail.compose.templateHint" : "mail.compose.fullHint") },
			[
				Element("i", { className: "fa-solid fa-feather-pointed", attributes: { "aria-hidden": "true" } }),
				Element("span", { text: T(draft.isFull ? "mail.compose.template" : "mail.compose.full") }),
			]);
			const discardButton = Element("button", { className: "desk-button is-quiet is-icon", title: T("mail.compose.discardHint"), attributes: { "aria-label": T("mail.compose.discard") } },
			[
				Element("i", { className: "fa-solid fa-trash-can", attributes: { "aria-hidden": "true" } }),
			]);
			const everyoneButton = official ? Element("button", { className: `desk-button ${draft.everyone ? "is-active" : ""}`, title: T("mail.official.everyoneHint") },
			[
				Element("i", { className: "fa-solid fa-users", attributes: { "aria-hidden": "true" } }),
				Element("span", { text: T("mail.official.everyoneButton") }),
			]) : null;

			modeButton.addEventListener("click", () =>
			{
				if (!draft.isFull)
				{
					// The template is written out once; from here on the greeting and signature are the player's to change.
					draft.fullText = GetLetterText();
					draft.isFull = true;
				}
				else if (Confirm(modeButton, "template", T("mail.compose.templateConfirm")))
				{
					draft.isFull = false;
					draft.fullText = "";
				}
				else
				{
					return;
				}

				SaveNow();
				Rebuild();
			});

			discardButton.addEventListener("click", () =>
			{
				if (Confirm(discardButton, "discard", T("mail.compose.discardConfirm")))
				{
					clearTimeout(saveTimer);
					saveTimer = null;
					Store.SaveDraft(draftKey, null);
					GoBack();
				}
			});

			if (everyoneButton)
			{
				everyoneButton.addEventListener("click", () =>
				{
					draft.everyone = !draft.everyone;
					SaveNow();
					Rebuild();
				});
			}

			// An official letter's sender is already named in its signature, so the title stays short enough for the extra button.
			const titleText = T(official ? "mail.official.composeTitle" : replyTo ? "mail.compose.titleReply" : "mail.compose.title");
			const title = Element("span", { className: "compose-title", text: titleText });
			// Leaving the letter (back, or throwing it away) sits on the left and the ways of writing it on the right, so both sides stay short enough for the title to sit over the sheet's centre.
			const start = Element("div", { className: "desk-toolbar-start" }, [backButton, discardButton]);
			const actions = Element("div", { className: "desk-toolbar-actions" }, [everyoneButton, modeButton].filter(Boolean));
			const toolbar = Element("div", { className: `desk-toolbar ${official ? "is-wide" : ""}` }, [start, title, actions]);
			let sheet = null;
			let focusTarget = null;
			picker = CreatePicker(!draft.isFull);

			if (draft.isFull)
			{
				const text = Element("textarea", { className: "sheet-text compose-full", attributes: { spellcheck: "false", maxlength: String(maxLength), placeholder: T("mail.compose.bodyPlaceholder") } });
				text.value = draft.fullText;
				text.addEventListener("input", () =>
				{
					draft.fullText = text.value;
					UpdateCounter();
					QueueSave();
				});
				sheet = Owls.Sheet.Create([text], "is-writing");
				focusTarget = text;
			}
			else
			{
				const body = Element("textarea", { className: "sheet-text compose-body", attributes: { spellcheck: "false", maxlength: String(maxLength), placeholder: T("mail.compose.bodyPlaceholder") } });
				body.value = draft.body;
				body.addEventListener("input", () =>
				{
					draft.body = body.value;
					UpdateCounter();
					QueueSave();
				});

				const closing = Element("div", { className: "compose-closing" },
				[
					Element("div", { className: "compose-line", text: T("mail.letter.closing") }),
					Element("div", { className: "compose-line compose-signature", text: signature }),
				]);

				sheet = Owls.Sheet.Create([picker.element, body, closing], "is-writing is-template");
				focusTarget = draft.recipients.length === 0 && !draft.everyone ? null : body;
			}

			// The seal is pressed onto the sheet itself, so it scales with it.
			sheet.sheet.appendChild(Element("div", { className: "compose-seal" }, [sealButton, sealHint]));
			const stage = Element("div", { className: "compose-stage" }, [sheet.slot]);

			const parts =
			[
				toolbar,
				draft.isFull ? Element("div", { className: "compose-address" }, [picker.element]) : null,
				stage,
				Element("div", { className: "compose-footer" }, [status, counter]),
			];

			element.replaceChildren(...parts.filter(Boolean));

			UpdateCounter();
			requestAnimationFrame(() => (focusTarget ? focusTarget.focus() : picker.Focus()));
		}

		/// <summary>
		/// Lay the screen out again, after a mode change.
		/// </summary>
		function Rebuild()
		{
			if (picker)
			{
				picker.Destroy();
			}

			Build();
		}

		// ========================
		// Sending
		// ========================

		/// <summary>
		/// The recipients as the server takes them: correspondents by contact ID, anyone else by owl number. The writer of an answered letter goes separately.
		/// </summary>
		/// <returns>[{ contactId } | { number }]</returns>
		function GetRecipientsToSend()
		{
			return draft.recipients.filter((recipient) => recipient.kind !== "reply").map((recipient) => (recipient.kind === "contact" ? { contactId: recipient.contactId } : { number: recipient.number }));
		}

		/// <summary>
		/// Seal the letter and send it, one copy per recipient (or, for an official letter to everyone, one announcement).
		/// </summary>
		async function Send()
		{
			if (isSending)
			{
				return;
			}

			const text = GetLetterText();
			const reply = draft.recipients.find((recipient) => recipient.kind === "reply");

			if (draft.recipients.length === 0 && !draft.everyone)
			{
				desk.ShowError(T("error.mail.noRecipients"));
				picker.Focus();
				return;
			}

			if ((draft.isFull ? draft.fullText : draft.body).trim().length === 0)
			{
				desk.ShowError(T("error.emptyOwl"));
				return;
			}

			if (text.length > maxLength)
			{
				desk.ShowError(T("mail.compose.tooLong", { max: maxLength }));
				return;
			}

			isSending = true;
			status.textContent = T("mail.compose.sending");
			UpdateCounter();

			const result = official
				? await Owls.Bridge.Request("mail.sendOfficial", { sender: official.number, everyone: draft.everyone, recipients: draft.everyone ? [] : GetRecipientsToSend(), body: text, clientKey: NewKey() })
				: await Owls.Bridge.Request("mail.send", { recipients: GetRecipientsToSend(), replyToId: reply ? reply.replyToId : 0, replyLabel: reply ? reply.name : "", body: text, clientKey: NewKey() });

			isSending = false;
			status.textContent = "";
			UpdateCounter();

			if (!result.ok)
			{
				desk.ShowError(result.error);
				return;
			}

			for (const contact of result.data.contacts || [])
			{
				Store.SaveContact(contact);
			}

			clearTimeout(saveTimer);
			saveTimer = null;
			Store.SaveDraft(draftKey, null);
			Store.NoteSent();

			const failed = (result.data.failed || []).map((failure) => ({ name: failure.name || T("mail.list.unknownRecipient"), error: T(failure.errorKey) }));
			desk.ShowDispatch(Number(result.data.sent) || 0, failed, !!result.data.everyone);

			if (official)
			{
				desk.ShowOfficial();
			}
			else
			{
				desk.ShowLetters({ box: "sent" });
			}
		}

		/// <summary>
		/// Ask where the player stands, which decides whether a letter may be written here.
		/// </summary>
		async function LoadPlace()
		{
			const result = await Owls.Bridge.Request("mail.place", {});

			if (result.ok)
			{
				Store.SetPost(result.data.post || null);
			}
		}

		Build();

		if (!official)
		{
			LoadPlace();
		}

		return {
			element,
			OnStore: (reason) =>
			{
				if (reason === "post")
				{
					UpdateCounter();
				}
			},
			Destroy: () =>
			{
				clearTimeout(confirmTimer);

				if (picker)
				{
					picker.Destroy();
				}

				if (saveTimer !== null)
				{
					SaveNow();
				}
			},
		};
	}

	return { Create };
})();
