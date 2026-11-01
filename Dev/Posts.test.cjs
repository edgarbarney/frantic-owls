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

test("post blips require an explicit boolean independently of owl props", () =>
{
	for (const showBlip of [undefined, false, "true", 1])
	{
		assert.equal(Clean([{ ...base, showBlip }])[0].showBlip, false);
	}
	const post = Clean([{ ...base, showBlip: true }])[0];
	assert.equal(post.showBlip, true);
	assert.equal(post.spawnOwl, false);
});

test("Field Guide post blips remain visible outside their region and preserve map boundaries", async () =>
{
	const markers = new Map([["location.42", { label: "Shared location" }]]);
	const api =
	{
		async upsert(marker)
		{
			markers.set(marker.id, marker);
		},
		remove(id, resource)
		{
			assert.equal(resource, "frantic-owls");
			return markers.delete(id);
		},
	};
	const service = new PostService({}, Clean([{ ...base, label: "The Hall", showBlip: true, areaId: "Castle", regionId: "Hall" }, { ...base, id: "hidden" }]), () => null, () => {}, "Use", () => ({ markers: api }));
	await service.RefreshBlips();
	assert.equal(markers.size, 2);
	const marker = markers.get("post.hall");
	assert.deepEqual(marker.position, base.position);
	assert.equal(marker.label, "The Hall");
	assert.equal(marker.ttl, 0);
	assert.equal(marker.areaId, "Castle");
	assert.equal(marker.icon, "UI_T_MiniMap_Waypoint");
	assert.equal(Object.hasOwn(marker, "regionId"), false);
	assert.equal(Object.hasOwn(marker, "audience"), false);
	assert.equal(marker.virtualWorld, 0);
	service.Forget();
	assert.ok(markers.has("post.hall"));
	service.SetPosts(Clean([{ ...base, showBlip: false }]));
	await service.RefreshBlips();
	assert.deepEqual([...markers.keys()], ["location.42"]);
	service.SetPosts(Clean([{ ...base, showBlip: true }]));
	await service.RefreshBlips();
	assert.equal(markers.get("post.hall").areaId, "Overland");
	service.Unregister();
	assert.deepEqual([...markers.keys()], ["location.42"]);
});

test("post blips recover when the optional registry starts or restarts", async () =>
{
	let registry = null;
	const published = [];
	const service = new PostService({}, Clean([{ ...base, showBlip: true }]), () => null, () => {}, "Use", () => registry);
	await service.RefreshBlips();
	assert.equal(published.length, 0);
	registry = { markers: { async upsert(marker) { published.push(marker); }, remove() {} } };
	await service.RefreshBlips();
	assert.equal(published.length, 1);
	service.ClearBlips();
	await service.RefreshBlips();
	assert.equal(published.length, 2);
	service.Unregister();
});

test("a failed blip does not prevent subsequent post markers", async () =>
{
	const published = [];
	const registry =
	{
		markers:
		{
			async upsert(marker)
			{
				if (marker.id === "post.hall")
				{
					throw new Error("Marker quota reached");
				}
				published.push(marker.id);
			},
			remove() {},
		},
	};
	const service = new PostService({}, Clean([{ ...base, showBlip: true }, { ...base, id: "tower", showBlip: true }]), () => null, () => {}, "Use", () => registry);
	await service.RefreshBlips();
	assert.deepEqual(published, ["post.tower"]);
	service.Unregister();
});

test("a reload or stop during asynchronous publication cannot leave a stale post marker", async () =>
{
	const markers = new Map();
	let release;
	let started;
	const pending = new Promise((resolve) => { started = resolve; });
	const registry =
	{
		markers:
		{
			async upsert(marker)
			{
				if (marker.label === "Old")
				{
					started();
					await new Promise((resolve) => { release = resolve; });
				}
				markers.set(marker.id, marker);
			},
			remove(id) { markers.delete(id); },
		},
	};
	const service = new PostService({}, Clean([{ ...base, label: "Old", showBlip: true }]), () => null, () => {}, "Use", () => registry);
	const oldRefresh = service.RefreshBlips();
	await pending;
	service.SetPosts(Clean([{ ...base, label: "New", showBlip: true }]));
	const newRefresh = service.RefreshBlips();
	release();
	await Promise.all([oldRefresh, newRefresh]);
	assert.equal(markers.get("post.hall").label, "New");
	service.Unregister();
	assert.equal(markers.size, 0);

	const stoppedService = new PostService({}, Clean([{ ...base, label: "Old", showBlip: true }]), () => null, () => {}, "Use", () => registry);
	const stoppingRefresh = stoppedService.RefreshBlips();
	await new Promise((resolve) => setImmediate(resolve));
	stoppedService.Unregister();
	release();
	await stoppingRefresh;
	assert.equal(markers.size, 0);
});
