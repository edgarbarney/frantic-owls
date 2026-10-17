// FranticDreamer 2026
"use strict";

const { Ok, Fail } = require("./Result.js");
const { ClampInteger } = require("./Config.js");
const { CheckAvatarUrl } = require("./Avatars.js");

/// <summary>
/// Outcome of adding a contact on someone else's behalf (Inform).
/// </summary>
const AddContactStatus = Object.freeze
({
	Added: "added",
	AlreadyKnown: "already-known",
	Full: "full",
	Failed: "failed",
});

// ========================
// Contact Service
// ========================

/// <summary>
/// Owns every change to a player's contact list.
/// Contacts are private to their owner: only the owner ever sees the name they chose.
///
/// <para>
/// NOTE: A contact's avatarUrl is an override. Every owl sets its own profile picture in Settings, which its contacts see by default;
/// a picture set here replaces it for this owner only, and clearing it (an empty link) goes back to the owl's own picture.
/// Records carry both (avatarUrl and profileAvatarUrl) so the page can pick without another round trip.
/// </para>
///
/// </summary>
class ContactService
{
	/// <summary>
	/// OwlDatabase instance.
	/// </summary>
	#database;

	/// <summary>
	/// hmp-lib server import, for text cleaning.
	/// </summary>
	#hmp;

	/// <summary>
	/// The "contacts" section of the server config.
	/// </summary>
	#config;

	/// <summary>
	/// The "avatars" section of the server config.
	/// </summary>
	#avatarsConfig;

	/// <summary>
	/// Clean and check a contact display name.
	/// </summary>
	/// <param name="raw">Client-supplied name</param>
	/// <returns>The cleaned name, or an empty string if it is unusable</returns>
	#CleanName(raw)
	{
		const name = this.#hmp.text.clean(raw, this.#config.maxNameLength).replace(/\s+/g, " ").trim();
		return name.length > 0 ? name : "";
	}

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="database">OwlDatabase instance</param>
	/// <param name="hmp">hmp-lib server import</param>
	/// <param name="contactsConfig">The "contacts" section of the server config</param>
	/// <param name="avatarsConfig">The "avatars" section of the server config</param>
	constructor(database, hmp, contactsConfig, avatarsConfig)
	{
		this.#database = database;
		this.#hmp = hmp;
		this.#config = contactsConfig;
		this.#avatarsConfig = avatarsConfig;
	}

	/// <summary>
	/// Every contact an owl has saved.
	/// </summary>
	/// <param name="number">Owner's owl number</param>
	/// <returns>Contact records, or null on failure</returns>
	async List(number)
	{
		return this.#database.ListContacts(number);
	}

	/// <summary>
	/// The contact an owl saved for another owl number, if any.
	/// </summary>
	/// <param name="ownerNumber">Owner's owl number</param>
	/// <param name="contactNumber">Owl number to look for</param>
	/// <returns>Contact record, null if none, or undefined on failure</returns>
	async FindByNumber(ownerNumber, contactNumber)
	{
		return this.#database.FindContactByNumber(ownerNumber, contactNumber);
	}

	/// <summary>
	/// Rename a contact and/or change their picture override (an empty link clears the override).
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ contactId, name, avatarUrl }</param>
	/// <returns>Result carrying the updated contact</returns>
	async Update(entry, data)
	{
		const contactId = ClampInteger(data.contactId, 0, Number.MAX_SAFE_INTEGER, 0);
		const name = this.#CleanName(data.name);
		const avatar = CheckAvatarUrl(data.avatarUrl, this.#avatarsConfig);

		if (contactId === 0)
		{
			return Fail("error.contactGone");
		}

		if (name.length === 0)
		{
			return Fail("error.contactNameMissing");
		}

		if (!avatar.ok)
		{
			return Fail(avatar.error);
		}

		const contact = await this.#database.GetContact(entry.number, contactId);

		if (!contact)
		{
			return Fail("error.contactGone");
		}

		if (!await this.#database.UpdateContact(entry.number, contactId, name, avatar.url))
		{
			return Fail("error.contactSaveFailed");
		}

		return Ok({ contact: { ...contact, name, avatarUrl: avatar.url, updatedAt: Date.now() } });
	}

	/// <summary>
	/// Remove a contact. Existing chats stay; that owl just shows as unknown again.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ contactId }</param>
	/// <returns>Result carrying the removed contact ID</returns>
	async Delete(entry, data)
	{
		const contactId = ClampInteger(data.contactId, 0, Number.MAX_SAFE_INTEGER, 0);

		if (contactId === 0 || !await this.#database.DeleteContact(entry.number, contactId))
		{
			return Fail("error.contactGone");
		}

		return Ok({ contactId });
	}

	/// <summary>
	/// Star a contact as a favourite, or unstar it. Favourites are listed first wherever contacts are listed.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ contactId, favourite }</param>
	/// <returns>Result carrying { contactId, favourite }</returns>
	async SetFavourite(entry, data)
	{
		const contactId = ClampInteger(data.contactId, 0, Number.MAX_SAFE_INTEGER, 0);
		const favourite = data.favourite === true;

		if (contactId === 0 || !await this.#database.SetContactFavourite(entry.number, contactId, favourite))
		{
			return Fail("error.contactGone");
		}

		return Ok({ contactId, favourite });
	}

	/// <summary>
	/// Save the other owl of a direct chat as a contact, for when someone owled you before you knew them.
	/// </summary>
	/// <param name="entry">Directory entry of the requesting owl</param>
	/// <param name="data">{ chatId, name }</param>
	/// <returns>Result carrying the new contact</returns>
	async SaveFromChat(entry, data)
	{
		const chatId = ClampInteger(data.chatId, 0, Number.MAX_SAFE_INTEGER, 0);
		const name = this.#CleanName(data.name);

		if (name.length === 0)
		{
			return Fail("error.contactNameMissing");
		}

		const chat = chatId > 0 ? await this.#database.GetChatForMember(chatId, entry.number) : null;

		if (!chat || chat.kind !== "direct")
		{
			return Fail("error.saveOnlyDirect");
		}

		const other = chat.members.find((member) => member !== entry.number);

		if (!other)
		{
			return Fail("error.saveOnlyDirect");
		}

		const result = await this.AddOnBehalf(entry.number, other, name);

		switch (result.status)
		{
		case AddContactStatus.Added:
			return Ok({ contact: result.contact });
		case AddContactStatus.AlreadyKnown:
			return Fail("error.alreadyContact");
		case AddContactStatus.Full:
			return Fail("error.contactsFull");
		default:
			return Fail("error.contactSaveFailed");
		}
	}

	/// <summary>
	/// Add a contact to an owl's list without overwriting one they already saved.
	/// Used by Inform, where the name comes from the sharing character rather than the owner.
	/// </summary>
	/// <param name="ownerNumber">Owl number receiving the contact</param>
	/// <param name="contactNumber">Owl number being added</param>
	/// <param name="name">Display name to save, cleaned here</param>
	/// <returns>{ status: AddContactStatus, contact }</returns>
	async AddOnBehalf(ownerNumber, contactNumber, name)
	{
		const cleanName = this.#CleanName(name) || "Unnamed Owl";
		const existing = await this.#database.FindContactByNumber(ownerNumber, contactNumber);

		if (existing === undefined)
		{
			return { status: AddContactStatus.Failed, contact: null };
		}

		if (existing)
		{
			return { status: AddContactStatus.AlreadyKnown, contact: existing };
		}

		const count = await this.#database.CountContacts(ownerNumber);

		if (count < 0)
		{
			return { status: AddContactStatus.Failed, contact: null };
		}

		if (count >= this.#config.maxContacts)
		{
			return { status: AddContactStatus.Full, contact: null };
		}

		const contact = await this.#database.InsertContact(ownerNumber, contactNumber, cleanName, "");

		if (!contact)
		{
			return { status: AddContactStatus.Failed, contact: null };
		}

		return { status: AddContactStatus.Added, contact };
	}
}

module.exports = { ContactService, AddContactStatus };
