// FranticDreamer 2026
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { LoadPosts } = require("../Server/Config.js");
const { PostService } = require("../Server/Posts.js");

/// <summary>
/// Sanitise post fixtures through the same path used by a live reload.
/// </summary>
function Clean(posts)
{
	return LoadPosts({ config: { load: () => ({ immersivemode_posts: posts }) } });
}

const base = { id: "hall", position: { x: 100, y: 200, z: 300 }, yaw: 90 };

test("owl spawning requires an explicit boolean and offsets default safely", () =>
{
	for (const spawnOwl of [undefined, false, "true", 1])
	{
		assert.equal(Clean([{ ...base, spawnOwl }])[0].spawnOwl, false);
	}
	assert.deepEqual(Clean([base])[0].owlOffset, { x: -1, y: 0, z: 175 });
	assert.deepEqual(Clean([{ ...base, spawnOwl: true, owlOffset: { x: 0, y: -20, z: 0 } }])[0].owlOffset, { x: 0, y: -20, z: 0 });
	assert.deepEqual(Clean([{ ...base, owlOffset: { x: Infinity, y: "2", z: null } }])[0].owlOffset, { x: -1, y: 0, z: 175 });
});

test("owl placement adds world offsets and cleans up across reloads and interaction restarts", () =>
{
	const created = [];
	global.WorldObject =
	{
		create(key, model, options)
		{
			const owl = { key, model, options, destroyed: 0, destroy() { this.destroyed++; }, setVirtualWorld(...args) { this.world = args; } };
			created.push(owl);
			return owl;
		},
	};
	try
	{
		const service = new PostService({}, Clean([{ ...base, spawnOwl: true }]), () => null, () => {}, "Use");
		service.Register();
		assert.equal(created.length, 1);
		assert.deepEqual(created[0].options, { x: 99, y: 200, z: 475, yaw: 90, collision: false });
		assert.match(created[0].model, /BP_PropOwl_OwlStation\.BP_PropOwl_OwlStation_C$/);
		assert.deepEqual(created[0].world, [0, "Overland"]);
		service.Forget();
		assert.equal(created[0].destroyed, 0);
		service.SetPosts(Clean([{ ...base, spawnOwl: true, areaId: "OtherMap", owlOffset: { x: 10, y: -10, z: 0 } }]));
		assert.equal(created[0].destroyed, 1);
		assert.deepEqual(created[1].options, { x: 110, y: 190, z: 300, yaw: 90, collision: false });
		assert.deepEqual(created[1].world, [0, "OtherMap"]);
		service.SetPosts(Clean([base]));
		assert.equal(created[1].destroyed, 1);
		assert.equal(created.length, 2);
		service.SetPosts(Clean([{ ...base, spawnOwl: true }]));
		service.Unregister();
		assert.equal(created[2].destroyed, 1);
	}
	finally
	{
		delete global.WorldObject;
	}
});

test("one failed owl spawn does not prevent prompts or later owls", () =>
{
	const prompts = [];
	const owls = [];
	global.WorldObject =
	{
		create(key)
		{
			if (key.includes("hall"))
			{
				throw new Error("Host refused the Blueprint");
			}
			owls.push(key);
			return { setVirtualWorld() {}, destroy() {} };
		},
	};
	try
	{
		const interact = { register(record) { prompts.push(record.id); return () => {}; } };
		const service = new PostService({}, Clean([{ ...base, spawnOwl: true }, { ...base, id: "tower", spawnOwl: true }]), () => interact, () => {}, "Use");
		service.Register();
		assert.equal(prompts.length, 2);
		assert.equal(owls.length, 1);
		service.Unregister();
	}
	finally
	{
		delete global.WorldObject;
	}
});
