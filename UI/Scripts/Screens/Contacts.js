// FranticDreamer 2026
"use strict";

// ========================
// Contacts Screen
// ========================

/// <summary>
/// Alphabetical contact list with a search field behind the search icon.
/// Tapping a contact opens their details; with numbers.dialling on, the plus adds one by typing in their owl number.
/// </summary>
Owls.Screens.Contacts = (() =>
{
	const { Element } = Owls.Util;
	const Widgets = Owls.Widgets;
	const T = Owls.Lang.T;

	/// <summary>
	/// The grey line under a contact's name: blocked, or gone for good.
	/// </summary>
	/// <param name="contact">Contact record</param>
	/// <returns>Subtitle, or ""</returns>
	function GetSubtitle(contact)
	{
		if (Owls.Store.IsRetired(contact.number))
		{
			return T("contacts.retired");
		}

		return Owls.Store.IsBlocked(contact.number) ? T("contacts.blocked") : "";
	}

	/// <summary>
	/// Create the screen.
	/// </summary>
	/// <returns>Screen instance</returns>
	function Create()
	{
		const body = Element("div", { className: "screen-body" });
		const search = Widgets.SearchToggle(T("contacts.search"), () => Refresh("contacts"));
		const addButton = Owls.Store.state.config.numbersDialling ? Widgets.IconButton(Owls.Icons.userPlus, T("dial.contactTitle"), () => Owls.App.Navigate("Dial", { mode: "contact" })) : null;
		const header = Widgets.Header(T("home.contacts"), [search.button, addButton]);
		const element = Element("div", { className: "screen" }, [header.element, search.row, body]);

		/// <summary>
		/// Rebuild the list.
		/// </summary>
		/// <param name="reason">Change reason from the store</param>
		function Refresh(reason)
		{
			if (reason !== "contacts" && reason !== "profiles" && reason !== "blocks" && reason !== "retired" && reason !== "reset" && reason !== "ready")
			{
				return;
			}

			const query = search.GetQuery();
			const contacts = Owls.Store.GetSortedContacts(query);

			if (contacts.length === 0)
			{
				body.replaceChildren(Widgets.EmptyState(query ? T("contacts.noMatch") : T("contacts.empty")));
				return;
			}

			body.replaceChildren(Widgets.GroupedContactList(contacts, (contact) => Widgets.ContactRow(contact, () => Owls.App.Navigate("ContactDetails", { contactId: contact.id }), { subtitle: GetSubtitle(contact) })));
		}

		Refresh("contacts");
		return { element, Refresh, Destroy: () => {} };
	}

	return { Create };
})();
