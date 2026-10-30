// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};
Owls.DeskScreens = Owls.DeskScreens || {};

// ========================
// Correspondents Screen
// ========================

/// <summary>
/// The player's correspondents (their contacts): everyone they have written to, anyone they added by name, and anyone another resource introduced them to.
/// Each can be renamed, starred, written to or forgotten, and given a picture where the server allows pictures (immersivemode_avatars).
///
/// <para>
/// NOTE: A correspondent first reached by answering an unsigned letter is listed by the name the player gave them and nothing else: no character name and no picture of their own,
/// which would tell the player who wrote to them anonymously.
/// </para>
///
/// </summary>
Owls.DeskScreens.Correspondents = (() =>
{
	const { Element, CreateAvatar } = Owls.Util;
	const T = Owls.Lang.T;
	const Store = Owls.MailStore;
	const Search = Owls.MailSearch;

	/// <summary>
	/// How long a forget button waits for its confirming second click.
	/// </summary>
	const confirmMs = 4000;

	/// <summary>
	/// Build the screen.
	/// </summary>
	/// <param name="desk">Owls.Desk, for navigation and messages</param>
	/// <returns>{ element, OnStore(reason), Destroy() }</returns>
	function Create(desk)
	{
		const config = Store.state.config;
		const addButton = Element("button", { className: "desk-button is-primary", on: { click: () => SetAdding(!isAdding) } },
		[
			Element("i", { className: "fa-solid fa-user-plus", attributes: { "aria-hidden": "true" } }),
			Element("span", { text: T("mail.correspondents.add") }),
		]);
		const head = Owls.DeskTabs.Create(desk, { active: "correspondents", action: addButton });
		const filterInput = Element("input", { className: "desk-input", attributes: { type: "search", autocomplete: "off", spellcheck: "false", placeholder: T("mail.correspondents.filter") } });
		const count = Element("span", { className: "correspondents-count" });
		const addInput = Element("input", { className: "desk-input", attributes: { type: "search", autocomplete: "off", spellcheck: "false", maxlength: "64", placeholder: T("mail.correspondents.addPlaceholder") } });
		const addResults = Element("ul", { className: "correspondents-found" });
		const addPanel = Element("div", { className: "correspondents-add" }, [Element("p", { className: "correspondents-add-hint", text: T("mail.correspondents.addHint") }), addInput, addResults]);
		const list = Element("ul", { className: "correspondents-list" });
		const empty = Element("p", { className: "letters-empty" });
		const element = Element("section", { className: "letters correspondents" },
		[
			head.element,
			Element("div", { className: "correspondents-bar" },
			[
				Element("span", { className: "desk-input-wrap" }, [Element("i", { className: "fa-solid fa-magnifying-glass", attributes: { "aria-hidden": "true" } }), filterInput]),
				count,
			]),
			addPanel,
			Element("div", { className: "letters-scroll" }, [list, empty]),
		]);

		let isAdding = false;
		let editingId = 0;
		let confirmingId = 0;
		let confirmTimer = null;
		let found = { query: "", owls: [], isPending: false };
		const searcher = Search.CreateSearcher((answer) =>
		{
			found = answer;
			RenderFound();
		});

		/// <summary>
		/// Show or hide the panel for adding a correspondent by name.
		/// </summary>
		/// <param name="adding">True to show it</param>
		function SetAdding(adding)
		{
			isAdding = adding;
			addPanel.hidden = !adding;
			addButton.classList.toggle("is-active", adding);

			if (adding)
			{
				addInput.value = "";
				found = { query: "", owls: [], isPending: false };
				RenderFound();
				addInput.focus();
			}
			else
			{
				searcher.Cancel();
			}
		}

		// ========================
		// Requests
		// ========================

		/// <summary>
		/// Save a character found by name as a correspondent.
		/// </summary>
		/// <param name="owl">{ number, name }</param>
		async function Add(owl)
		{
			const result = await Owls.Bridge.Request("mail.addCorrespondent", { number: owl.number });

			if (!result.ok)
			{
				desk.ShowError(result.error);
				return;
			}

			Store.SaveContact(result.data.contact);
			desk.ShowNotice(T("mail.correspondents.added", { name: result.data.contact.name }), "");
			addInput.value = "";
			found = { query: "", owls: [], isPending: false };
			RenderFound();
		}

		/// <summary>
		/// Rename a correspondent and change their picture.
		/// </summary>
		/// <param name="contact">Correspondent</param>
		/// <param name="name">New name</param>
		/// <param name="avatarUrl">New picture link ("" for none); ignored where pictures are off</param>
		async function Save(contact, name, avatarUrl)
		{
			const request = config.avatars ? { contactId: contact.id, name, avatarUrl } : { contactId: contact.id, name };
			const result = await Owls.Bridge.Request("contacts.update", request);

			if (!result.ok)
			{
				desk.ShowError(result.error);
				return;
			}

			editingId = 0;
			Store.SaveContact(result.data.contact);
		}

		/// <summary>
		/// Star or unstar a correspondent; starred ones are listed first, here and among suggestions.
		/// </summary>
		/// <param name="contact">Correspondent</param>
		async function ToggleFavourite(contact)
		{
			const result = await Owls.Bridge.Request("contacts.favourite", { contactId: contact.id, favourite: !contact.favourite });

			if (!result.ok)
			{
				desk.ShowError(result.error);
				return;
			}

			Store.SaveContact({ ...contact, favourite: result.data.favourite });
		}

		/// <summary>
		/// Forget a correspondent, on the second click. Letters to and from them stay.
		/// </summary>
		/// <param name="contact">Correspondent</param>
		async function Forget(contact)
		{
			if (confirmingId !== contact.id)
			{
				confirmingId = contact.id;
				clearTimeout(confirmTimer);
				confirmTimer = setTimeout(() =>
				{
					confirmingId = 0;
					Render();
				}, confirmMs);
				Render();
				return;
			}

			clearTimeout(confirmTimer);
			confirmingId = 0;
			const result = await Owls.Bridge.Request("contacts.delete", { contactId: contact.id });

			if (!result.ok)
			{
				desk.ShowError(result.error);
				Render();
				return;
			}

			Store.RemoveContact(contact.id);
		}

		// ========================
		// Drawing
		// ========================

		/// <summary>
		/// A round icon button.
		/// </summary>
		/// <param name="icon">Font Awesome icon class</param>
		/// <param name="title">Tooltip</param>
		/// <param name="OnClick">Click handler</param>
		/// <param name="extraClass">Extra class ("" for none)</param>
		/// <returns>Button</returns>
		function IconButton(icon, title, OnClick, extraClass = "")
		{
			return Element("button", { className: `desk-icon is-small ${extraClass}`.trim(), title, attributes: { "aria-label": title }, on: { click: OnClick } }, [Element("i", { className: icon, attributes: { "aria-hidden": "true" } })]);
		}

		/// <summary>
		/// The picture of a correspondent: their picture where the server allows pictures, otherwise their initials on a disc.
		/// The disc's colour comes from the name rather than the ID, since IDs in a row would give nearly the same colour.
		/// </summary>
		/// <param name="contact">Correspondent</param>
		/// <returns>Avatar element</returns>
		function CreatePicture(contact)
		{
			return CreateAvatar(contact.name, Store.GetContactPicture(contact), contact.name, "is-desk");
		}

		/// <summary>
		/// One correspondent, as listed.
		/// </summary>
		/// <param name="contact">Correspondent</param>
		/// <returns>List item</returns>
		function CreateRow(contact)
		{
			const isConfirming = confirmingId === contact.id;

			return Element("li", { className: `correspondent-row ${contact.favourite ? "is-favourite" : ""}` },
			[
				CreatePicture(contact),
				Element("span", { className: "correspondent-lines" },
				[
					Element("span", { className: "correspondent-name", text: Store.GetContactLabel(contact) }),
				]),
				Element("span", { className: "correspondent-actions" },
				[
					IconButton(contact.favourite ? "fa-solid fa-star" : "fa-regular fa-star", T(contact.favourite ? "mail.correspondents.unstar" : "mail.correspondents.star"), () => ToggleFavourite(contact), contact.favourite ? "is-on" : ""),
					IconButton("fa-solid fa-feather-pointed", T("mail.correspondents.write"), () => desk.Compose({ to: contact })),
					IconButton("fa-solid fa-pen", T("mail.correspondents.edit"), () =>
					{
						editingId = contact.id;
						Render();
					}),
					isConfirming
						? Element("button", { className: "desk-button is-confirming correspondent-forget", on: { click: () => Forget(contact) } }, [Element("span", { text: T("mail.correspondents.forgetConfirm") })])
						: IconButton("fa-solid fa-trash-can", T("mail.correspondents.forget"), () => Forget(contact)),
				]),
			]);
		}

		/// <summary>
		/// One correspondent being edited: their name and, where allowed, their picture.
		/// </summary>
		/// <param name="contact">Correspondent</param>
		/// <returns>List item</returns>
		function CreateEditor(contact)
		{
			const nameInput = Element("input", { className: "desk-input", attributes: { type: "text", maxlength: String(config.maxNameLength || 40), spellcheck: "false" } });
			const pictureInput = Element("input", { className: "desk-input", attributes: { type: "text", maxlength: String(config.maxAvatarUrlLength || 512), spellcheck: "false", placeholder: "https://i.imgur.com/example.gif" } });
			const picture = Element("span", { className: "correspondent-picture" }, [CreatePicture(contact)]);
			nameInput.value = contact.name;
			pictureInput.value = contact.avatarUrl;

			/// <summary>
			/// Show the picture as it would look with what is typed.
			/// </summary>
			function Preview()
			{
				const url = pictureInput.value.trim() || contact.profileAvatarUrl;
				picture.replaceChildren(CreateAvatar(nameInput.value || contact.name, config.avatars ? url : "", nameInput.value || contact.name, "is-desk"));
			}

			const submit = () => Save(contact, nameInput.value, pictureInput.value);
			nameInput.addEventListener("input", Preview);
			pictureInput.addEventListener("input", Preview);

			for (const input of [nameInput, pictureInput])
			{
				input.addEventListener("keydown", (event) =>
				{
					if (event.key === "Enter")
					{
						event.preventDefault();
						submit();
					}
					else if (event.key === "Escape")
					{
						event.preventDefault();
						event.stopPropagation();
						editingId = 0;
						Render();
					}
				});
			}

			requestAnimationFrame(() => nameInput.focus());

			return Element("li", { className: "correspondent-row is-editing" },
			[
				picture,
				Element("span", { className: "correspondent-fields" },
				[
					Element("label", { className: "correspondent-field" }, [Element("span", { text: T("mail.correspondents.name") }), nameInput]),
					contact.originalName ? Element("span", { className: "correspondent-original", text: T("mail.correspondents.originalName", { name: contact.originalName }) }) : null,
					config.avatars ? Element("label", { className: "correspondent-field" }, [Element("span", { text: T("mail.correspondents.picture") }), pictureInput]) : null,
				]),
				Element("span", { className: "correspondent-actions" },
				[
					Element("button", { className: "desk-button is-primary", on: { click: submit } }, [Element("span", { text: T("common.save") })]),
					Element("button", { className: "desk-button is-quiet", on: { click: () => { editingId = 0; Render(); } } }, [Element("span", { text: T("common.cancel") })]),
				]),
			]);
		}

		/// <summary>
		/// Draw the characters found by name for adding, leaving out those already among the correspondents.
		/// </summary>
		function RenderFound()
		{
			const known = Store.GetKnownNumbers();
			const owls = found.owls.filter((owl) => !known.has(owl.number));
			let rows = owls.map((owl) => Element("li", { className: "correspondents-found-row" },
			[
				Element("span", { className: "correspondent-name", text: owl.name }),
				owl.online ? Element("span", { className: "picker-online", title: T("mail.compose.online") }) : null,
				Element("button", { className: "desk-button", on: { click: () => Add(owl) } }, [Element("i", { className: "fa-solid fa-plus", attributes: { "aria-hidden": "true" } }), Element("span", { text: T("mail.correspondents.addOne") })]),
			]));

			if (found.isPending)
			{
				rows = [Element("li", { className: "correspondents-found-note", text: T("mail.compose.searching") })];
			}
			else if (rows.length === 0 && addInput.value.trim().length > 0)
			{
				rows = [Element("li", { className: "correspondents-found-note", text: T(Search.Fold(addInput.value).length < Search.minQueryLength ? "mail.compose.typeMore" : "mail.compose.noMatches") })];
			}

			addResults.replaceChildren(...rows);
		}

		/// <summary>
		/// Draw the list from the store.
		/// </summary>
		function Render()
		{
			const query = filterInput.value.trim();
			const contacts = Store.state.contacts.filter((contact) => Search.Matches(contact.name, query) || Search.Matches(contact.originalName, query));

			head.Render();
			list.replaceChildren(...contacts.map((contact) => (contact.id === editingId ? CreateEditor(contact) : CreateRow(contact))));
			count.textContent = T("mail.correspondents.count", { count: Store.state.contacts.length, max: config.maxContacts || 250 });
			empty.textContent = T(Store.state.contacts.length === 0 ? "mail.correspondents.empty" : "mail.correspondents.noMatches");
			empty.hidden = contacts.length > 0;
		}

		filterInput.addEventListener("input", Render);
		addInput.addEventListener("input", () =>
		{
			searcher.Find(addInput.value);
			RenderFound();
		});

		addPanel.hidden = true;
		Render();

		return {
			element,
			OnStore: (reason) =>
			{
				if (reason === "contacts" || reason === "settings" || reason === "letters" || reason === "arrived")
				{
					Render();

					if (isAdding)
					{
						RenderFound();
					}
				}
			},
			Destroy: () =>
			{
				clearTimeout(confirmTimer);
				searcher.Cancel();
			},
		};
	}

	return { Create };
})();
