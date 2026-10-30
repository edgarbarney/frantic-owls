// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};
Owls.Screens = Owls.Screens || {};

// ========================
// Shared Screen Widgets
// ========================

/// <summary>
/// Building blocks several screens share: headers, icon buttons, the search toggle and contact rows.
///
/// <para>
/// Every screen module exposes Create(params) returning { element, Refresh(reason), Destroy() }.
/// Screens build their static parts (header, inputs) once and only rebuild their lists in Refresh,
/// so typing into a field is never interrupted by an owl arriving.
/// </para>
///
/// </summary>
Owls.Widgets = (() =>
{
	const { Element } = Owls.Util;
	const T = Owls.Lang.T;

	/// <summary>
	/// Round button holding one icon.
	/// </summary>
	/// <param name="icon">Icon markup from Owls.Icons</param>
	/// <param name="title">Tooltip</param>
	/// <param name="onClick">Click handler</param>
	/// <param name="className">Extra classes (optional)</param>
	/// <returns>Button element</returns>
	function IconButton(icon, title, onClick, className = "")
	{
		const button = Element("button", { className: `icon-button ${className}`.trim(), title, on: { click: onClick } });
		button.innerHTML = icon;
		return button;
	}

	/// <summary>
	/// Screen header with a back button, a title and optional action buttons on the right.
	/// </summary>
	/// <param name="title">Title text</param>
	/// <param name="actions">Elements placed after the title (optional)</param>
	/// <returns>{ element, title } where title is the title element, for screens that rename themselves</returns>
	function Header(title, actions = [])
	{
		const titleElement = Element("div", { className: "screen-title", text: title });
		const element = Element("div", { className: "screen-header" },
		[
			IconButton(Owls.Icons.back, T("common.back"), () => Owls.App.Back()),
			titleElement,
			...actions,
		]);

		return { element, title: titleElement };
	}

	/// <summary>
	/// A search icon that reveals a search field underneath the header when clicked, and hides and clears it on a second click.
	/// </summary>
	/// <param name="placeholder">Field placeholder</param>
	/// <param name="onQuery">Called with the query on every keystroke</param>
	/// <returns>{ button, row, GetQuery() }</returns>
	function SearchToggle(placeholder, onQuery)
	{
		const input = Element("input", { className: "text-input", attributes: { type: "text", placeholder, maxlength: 64 } });
		const row = Element("div", { className: "search-row" }, [input]);
		row.hidden = true;

		input.addEventListener("input", () => onQuery(input.value));

		const button = IconButton(Owls.Icons.search, T("common.search"), () =>
		{
			row.hidden = !row.hidden;

			if (row.hidden)
			{
				input.value = "";
				onQuery("");
			}
			else
			{
				input.focus();
			}
		});

		return { button, row, GetQuery: () => (row.hidden ? "" : input.value) };
	}

	/// <summary>
	/// A drop-down list: a button showing the chosen option, which opens the list of every option below it.
	///
	/// <para>
	/// NOTE: Built from buttons rather than a select element on purpose.
	/// The game draws its browser off screen, and a select's list is a separate native pop-up that such browsers often never paint, leaving a dropdown that opens invisibly.
	/// </para>
	///
	/// </summary>
	/// <param name="options">[{ value, label }] in display order</param>
	/// <param name="onPick">Called with the value picked, even when it is the one already chosen (e.g. to play a sound again)</param>
	/// <param name="icon">Icon markup shown before the label (optional)</param>
	/// <returns>{ element, Set(value), Close() }</returns>
	function Dropdown(options, onPick, icon = "")
	{
		let current = null;

		const iconHolder = icon ? Element("span", { className: "dropdown-icon" }) : null;
		const label = Element("span", { className: "dropdown-label" });
		const chevron = Element("span", { className: "dropdown-chevron" });
		const button = Element("button", { className: "dropdown-button" }, [iconHolder, label, chevron]);
		const list = Element("div", { className: "dropdown-list" });
		const element = Element("div", { className: "dropdown" }, [button, list]);

		if (iconHolder)
		{
			iconHolder.innerHTML = icon;
		}

		chevron.innerHTML = Owls.Icons.chevronDown;
		list.hidden = true;

		// Close the list when the player clicks anywhere else.
		const OnOutside = (event) =>
		{
			if (!element.contains(event.target))
			{
				Close();
			}
		};

		/// <summary>
		/// Show which option is chosen.
		/// </summary>
		/// <param name="value">Option value</param>
		function Set(value)
		{
			current = value;
			const option = options.find((candidate) => candidate.value === value);
			label.textContent = option ? option.label : "";
		}

		/// <summary>
		/// Fold the list away.
		/// </summary>
		function Close()
		{
			list.hidden = true;
			element.classList.remove("is-open");
			document.removeEventListener("mousedown", OnOutside, true);
		}

		/// <summary>
		/// Unfold the list, with the chosen option ticked and scrolled into view.
		/// </summary>
		function Open()
		{
			list.replaceChildren(...options.map((option) =>
			{
				const isActive = option.value === current;
				const row = Element("button", { className: `dropdown-option${isActive ? " is-active" : ""}`, on: { click: () =>
				{
					Close();
					Set(option.value);
					onPick(option.value);
				} } }, [Element("span", { text: option.label })]);

				if (isActive)
				{
					row.insertAdjacentHTML("beforeend", Owls.Icons.check);
				}

				return row;
			}));

			list.hidden = false;
			element.classList.add("is-open");
			document.addEventListener("mousedown", OnOutside, true);

			const active = list.querySelector(".is-active");

			if (active)
			{
				active.scrollIntoView({ block: "nearest" });
			}
		}

		button.addEventListener("click", () => (list.hidden ? Open() : Close()));
		return { element, Set, Close };
	}

	/// <summary>
	/// List row for a contact.
	/// </summary>
	/// <param name="contact">Contact record</param>
	/// <param name="onClick">Click handler</param>
	/// <param name="options">{ subtitle, isSelected, isSelectable }</param>
	/// <returns>Row element</returns>
	function ContactRow(contact, onClick, options = {})
	{
		const text = Element("span", { className: "row-text" },
		[
			Element("span", { className: "row-title", text: Owls.Store.GetContactLabel(contact) }),
			options.subtitle ? Element("span", { className: "row-subtitle", text: options.subtitle }) : null,
		]);

		let check = null;

		if (options.isSelectable)
		{
			check = Element("span", { className: "check" });
			check.innerHTML = options.isSelected ? Owls.Icons.check : "";
		}

		return Element("button", { className: `list-row${options.isSelected ? " is-selected" : ""}`, on: { click: onClick } },
		[
			Owls.Util.CreateAvatar(contact.name, Owls.Store.GetAvatarUrl(contact.number), contact.number),
			text,
			check,
		]);
	}

	/// <summary>
	/// Contact rows grouped under alphabetical letter headings, like a phone's address book.
	/// Favourites are also listed together at the top, under a star, so the people you owl most are found first.
	/// </summary>
	/// <param name="contacts">Contacts, already sorted by name</param>
	/// <param name="createRow">Function building the row of one contact</param>
	/// <returns>Document fragment</returns>
	function GroupedContactList(contacts, createRow)
	{
		const fragment = document.createDocumentFragment();
		const favourites = contacts.filter((contact) => contact.favourite);
		let letter = null;

		if (favourites.length > 0)
		{
			const heading = Element("div", { className: "section-letter is-favourites" });
			heading.innerHTML = Owls.Icons.star;
			heading.appendChild(Element("span", { text: T("contacts.favourites") }));
			fragment.appendChild(heading);

			for (const contact of favourites)
			{
				fragment.appendChild(createRow(contact));
			}
		}

		for (const contact of contacts)
		{
			const first = contact.name.charAt(0).toLocaleUpperCase(Owls.Lang.GetId());
			const heading = /\p{L}/u.test(first) ? first : "#";

			if (heading !== letter)
			{
				letter = heading;
				fragment.appendChild(Element("div", { className: "section-letter", text: heading }));
			}

			fragment.appendChild(createRow(contact));
		}

		return fragment;
	}

	/// <summary>
	/// Centred italic hint shown when a list is empty.
	/// </summary>
	/// <param name="text">Hint</param>
	/// <returns>Element</returns>
	function EmptyState(text)
	{
		return Element("div", { className: "empty-state", text });
	}

	return { IconButton, Header, SearchToggle, Dropdown, ContactRow, GroupedContactList, EmptyState };
})();
