// FranticDreamer 2026
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ReportService } = require("../Server/Reports.js");

const reader = "20000001";
const writer = "20000002";

/// <summary>
/// A report service over a fake database: one direct chat holding the given owls, and a moderator check the test decides.
/// </summary>
/// <param name="options">{ messages, isModerator }</param>
/// <returns>{ service, inserted }</returns>
function Create(options = {})
{
	const messages = options.messages || [{ id: 5, chatId: 1, sender: writer, kind: "text", body: "Hello", sentAt: 1, deliverAt: 0, unsentAt: 0, forwarded: false, replyTo: null }];
	const inserted = [];
	const database =
	{
		GetLetter: async (viewer, id) => messages.find((message) => message.id === id) || null,
		GetChat: async () => ({ id: 1, kind: "direct", title: "", members: [reader, writer] }),
		ListMessagesAround: async () => messages,
		GetNumberName: async (number) => (number === reader ? "Harriet" : "Ominis"),
		InsertReport: async (report, members, copied) =>
		{
			inserted.push({ report, members, copied });
			return { id: inserted.length, isNew: true };
		},
		GetReport: async (id) => (id === 1 ? { id: 1, messageId: 50, members: [] } : null),
		ListReportMessages: async () => ({ messages: messages.map((message) => ({ ...message })), hasOlder: false, hasNewer: false }),
		CountOpenReports: async () => 1,
	};
	const service = new ReportService(
	{
		database,
		directory: { All: () => [] },
		outbox: { Push: () => {} },
		senders: { GetName: () => "Ministry" },
		audit: { Log: () => {} },
		hmp: { rateLimit: { create: () => ({ allow: () => true, sweep: () => {} }) } },
		config: { reports: { enabled: true } },
		CanModerate: async () => options.isModerator === true,
		Describe: (number) => number,
	});

	return { service, inserted };
}

const entry = { number: reader, player: {}, characterName: "Harriet" };

test("a report copies the chat with every member's name, and is refused for the reporter's own or an official owl", async () =>
{
	const { service, inserted } = Create();
	const result = await service.File(entry, { messageId: 5 }, "phone");
	assert.equal(result.ok, true);
	assert.deepEqual(inserted[0].members, [{ number: reader, name: "Harriet" }, { number: writer, name: "Ominis" }]);

	const own = Create({ messages: [{ id: 6, chatId: 1, sender: reader, kind: "text", body: "Mine" }] });
	assert.equal((await own.service.File(entry, { messageId: 6 }, "phone")).ok, false);
	assert.equal(own.inserted.length, 0);

	const official = Create({ messages: [{ id: 7, chatId: 1, sender: "00000001", kind: "text", body: "Decree" }] });
	assert.equal((await official.service.File(entry, { messageId: 7 }, "phone")).ok, false);
});

test("only moderators read reports", async () =>
{
	const { service } = Create({ isModerator: false });
	assert.equal((await service.List(entry, {})).ok, false);
	assert.equal((await service.Open(entry, { reportId: 1 })).ok, false);
	assert.equal((await service.SetStatus(entry, { reportId: 1, status: "resolved" })).ok, false);
	assert.deepEqual(await service.GetAccess(entry), { canModerate: false, open: 0 });
});

test("an opened report fits the batch budget and always keeps the reported owl", async () =>
{
	// Forty long letters around the reported one (ID 50) are far over the page budget.
	const letters = Array.from({ length: 41 }, (_, index) => ({ id: 30 + index, sender: index % 2 ? reader : writer, kind: "text", body: "x".repeat(3000), sentAt: index }));
	const { service } = Create({ messages: letters, isModerator: true });
	const result = await service.Open(entry, { reportId: 1 });
	const page = result.data.page;
	const bytes = page.messages.reduce((total, message) => total + Buffer.byteLength(JSON.stringify(message), "utf8"), 0);

	assert.equal(result.ok, true);
	assert.ok(page.messages.some((message) => message.id === 50));
	assert.ok(bytes <= 16000);
	assert.equal(page.hasOlder, true);
	assert.equal(page.hasNewer, true);
});
