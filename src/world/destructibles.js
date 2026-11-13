import * as THREE from 'three';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();

export function createDestructibles(engine) {
    const registry = [];
    const crates = [];
    const hescos = [];
    const dragonsTeeth = [];
    const duckboards = [];

    let octreeRebuildPending = false;

    function registerDestructible({
        mesh,
        kind = 'crate',
        hp = 100,
        maxHp = 100,
        colliderHandle = null,
        surface = 'wood',
        penetrable = null,
        onBreak = null
    }) {
        if (!mesh) return null;
        mesh.userData.destructible = true;
        mesh.userData.surface = surface;
        if (penetrable) mesh.userData.penetrable = penetrable;

        const entry = {
            mesh,
            kind,
            hp,
            maxHp,
            colliderHandle,
            broken: false,
            onBreak
        };
        registry.push(entry);
        if (kind === 'crate') crates.push(entry);
        else if (kind === 'hesco') hescos.push(entry);
        else if (kind === 'dragons_teeth') dragonsTeeth.push(entry);
        else if (kind === 'duckboard') duckboards.push(entry);

        return entry;
    }

    function breakCrate(entry, impulseDir) {
        if (entry.broken) return;
        entry.broken = true;
        const mesh = entry.mesh;
        mesh.visible = false;

        if (entry.colliderHandle && engine.ragdollPhysics) {
            engine.ragdollPhysics.removeStaticCollider(entry.colliderHandle);
        }

        const idx = engine.staticShootableMeshes.indexOf(mesh);
        if (idx !== -1) engine.staticShootableMeshes.splice(idx, 1);

        const pos = mesh.position;
        const pieces = 6;
        for (let i = 0; i < pieces; i++) {
            const w = 0.25 + Math.random() * 0.25;
            const h = 0.08 + Math.random() * 0.12;
            const d = 0.2 + Math.random() * 0.25;
            const chunkGeo = new THREE.BoxGeometry(w, h, d);
            const chunkMat = new THREE.MeshStandardMaterial({ color: 0x826542, roughness: 0.88 });
            const chunkMesh = new THREE.Mesh(chunkGeo, chunkMat);
            chunkMesh.position.set(
                pos.x + (Math.random() - 0.5) * 0.6,
                pos.y + 0.2 + Math.random() * 0.5,
                pos.z + (Math.random() - 0.5) * 0.6
            );
            chunkMesh.castShadow = true;

            const dir = impulseDir ? impulseDir.clone() : new THREE.Vector3((Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 2);
            dir.normalize();

            if (engine.ragdollPhysics?.spawnDebris) {
                engine.ragdollPhysics.spawnDebris(chunkMesh, {
                    shape: { type: 'box', half: [w * 0.5, h * 0.5, d * 0.5] },
                    mass: 4.0,
                    linvel: { x: dir.x * 6 + (Math.random() - 0.5) * 3, y: Math.max(3, dir.y * 7), z: dir.z * 6 + (Math.random() - 0.5) * 3 },
                    angvel: { x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 12, z: (Math.random() - 0.5) * 12 },
                    ttl: 8.0,
                    friction: 0.85
                });
            } else {
                engine.scene.add(chunkMesh);
            }
        }

        if (entry.onBreak) entry.onBreak(entry);
        scheduleOctreeRebuild();
    }

    function breakHesco(entry, impactPos) {
        if (entry.broken) return;
        entry.broken = true;
        const mesh = entry.mesh;

        if (entry.colliderHandle && engine.ragdollPhysics) {
            engine.ragdollPhysics.removeStaticCollider(entry.colliderHandle);
        }

        mesh.scale.set(1.15, 0.38, 1.15);
        mesh.position.y = 0.1;
        mesh.updateMatrixWorld(true);

        const newCol = engine.ragdollPhysics?.addStaticBoxCollider(
            mesh.position,
            { x: 1.8, y: 0.4, z: 1.8 }
        );
        entry.colliderHandle = newCol;

        const pos = mesh.position;
        for (let i = 0; i < 4; i++) {
            const bagGeo = new THREE.BoxGeometry(0.5, 0.25, 0.7);
            const bagMat = new THREE.MeshStandardMaterial({ color: 0x9b937e, roughness: 0.95 });
            const bag = new THREE.Mesh(bagGeo, bagMat);
            bag.position.set(pos.x + (Math.random() - 0.5) * 1.8, 0.4 + Math.random() * 0.6, pos.z + (Math.random() - 0.5) * 1.8);
            if (engine.ragdollPhysics?.spawnDebris) {
                engine.ragdollPhysics.spawnDebris(bag, {
                    shape: { type: 'box', half: [0.25, 0.125, 0.35] },
                    mass: 22.0,
                    linvel: { x: (Math.random() - 0.5) * 4, y: 2.5 + Math.random() * 2, z: (Math.random() - 0.5) * 4 },
                    ttl: 12.0
                });
            }
        }

        if (entry.onBreak) entry.onBreak(entry);
        scheduleOctreeRebuild();
    }

    function toppleDragonsTooth(entry, blastDir) {
        if (entry.broken) return;
        entry.broken = true;
        const mesh = entry.mesh;

        if (entry.colliderHandle && engine.ragdollPhysics) {
            engine.ragdollPhysics.removeStaticCollider(entry.colliderHandle);
        }

        const idx = engine.staticShootableMeshes.indexOf(mesh);
        if (idx !== -1) engine.staticShootableMeshes.splice(idx, 1);

        if (engine.ragdollPhysics?.addDynamicProp) {
            const prop = engine.ragdollPhysics.addDynamicProp({
                object3d: mesh,
                shape: { type: 'cone', halfHeight: 0.8, r: 0.9 },
                mass: 850,
                friction: 0.88,
                restitution: 0.05
            });
            if (prop && blastDir) {
                engine.ragdollPhysics.applyPropImpulse(prop, blastDir.clone().multiplyScalar(4500));
            }
        } else {
            mesh.rotation.x = Math.PI * 0.45;
            mesh.position.y = 0.2;
        }

        if (entry.onBreak) entry.onBreak(entry);
        scheduleOctreeRebuild();
    }

    function scheduleOctreeRebuild() {
        if (octreeRebuildPending) return;
        octreeRebuildPending = true;
        setTimeout(() => {
            rebuildOctree();
            octreeRebuildPending = false;
        }, 150);
    }

    function rebuildOctree() {
        if (!engine.octree) return;
        const newOctree = new engine.octree.constructor();
        if (engine.groundMaterial && engine.provingGroundGroup) {
            for (const child of engine.provingGroundGroup.children) {
                if (child.visible && !child.userData.destructibleBroken) {
                    newOctree.fromGraphNode(child);
                }
            }
        }
        for (const item of registry) {
            if (!item.broken && item.mesh.visible) {
                newOctree.fromGraphNode(item.mesh);
            }
        }
        engine.octree = newOctree;
    }

    function damageAt(pos, radius, energy) {
        for (let i = 0; i < registry.length; i++) {
            const entry = registry[i];
            if (entry.broken) continue;
            const dist = entry.mesh.position.distanceTo(pos);
            if (dist > radius) continue;

            const falloff = 1.0 - dist / radius;
            const appliedDmg = energy * falloff;
            entry.hp -= appliedDmg;

            if (entry.hp <= 0) {
                _v1.subVectors(entry.mesh.position, pos).normalize();
                if (entry.kind === 'crate') breakCrate(entry, _v1);
                else if (entry.kind === 'hesco') breakHesco(entry, pos);
                else if (entry.kind === 'dragons_teeth') toppleDragonsTooth(entry, _v1);
            }
        }
    }

    function buildCoverWorldElements() {
        const crateMat = new THREE.MeshStandardMaterial({ color: 0x6e5234, roughness: 0.9, metalness: 0.05 });
        const crateCoords = [
            { x: -14.0, y: 0.45, z: 18.5, rot: 0.2 },
            { x: -13.2, y: 0.45, z: 18.6, rot: -0.15 },
            { x: -13.6, y: 1.25, z: 18.55, rot: 0.05 },
            { x: 14.0,  y: 0.45, z: 18.5, rot: 0.1 },
            { x: 14.8,  y: 0.45, z: 18.7, rot: -0.3 },
            { x: -8.0,  y: 0.45, z: -27.5, rot: 0.25 },
            { x: 8.0,   y: 0.45, z: -27.5, rot: -0.1 }
        ];

        for (const c of crateCoords) {
            const crateMesh = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.8), crateMat);
            crateMesh.position.set(c.x, c.y, c.z);
            crateMesh.rotation.y = c.rot;
            crateMesh.castShadow = true;
            crateMesh.receiveShadow = true;
            crateMesh.userData.ammoCrate = true;
            crateMesh.userData.surface = 'wood';
            crateMesh.userData.penetrable = { mm: 25, material: 'wood' };
            engine.scene.add(crateMesh);
            engine.staticShootableMeshes.push(crateMesh);

            const colHandle = engine.ragdollPhysics?.addStaticBoxCollider(
                crateMesh.position,
                { x: 0.5, y: 0.4, z: 0.4 },
                crateMesh.quaternion
            );

            registerDestructible({
                mesh: crateMesh,
                kind: 'crate',
                hp: 60,
                maxHp: 60,
                colliderHandle: colHandle,
                surface: 'wood',
                penetrable: { mm: 25, material: 'wood' }
            });
        }

        const sandbagParapetMat = new THREE.MeshStandardMaterial({ color: 0x8a7f6c, roughness: 0.95 });
        const parapetSegments = [
            { x: -16.0, z: -28.5, w: 4.0, h: 0.9, d: 0.8 },
            { x: -10.0, z: -28.5, w: 4.0, h: 0.9, d: 0.8 },
            { x: 10.0,  z: -28.5, w: 4.0, h: 0.9, d: 0.8 },
            { x: 16.0,  z: -28.5, w: 4.0, h: 0.9, d: 0.8 }
        ];

        for (const seg of parapetSegments) {
            const parapet = new THREE.Mesh(new THREE.BoxGeometry(seg.w, seg.h, seg.d), sandbagParapetMat);
            parapet.position.set(seg.x, seg.h * 0.5, seg.z);
            parapet.castShadow = true;
            parapet.receiveShadow = true;
            parapet.userData.surface = 'sandbag';
            parapet.userData.penetrable = { mm: 350, material: 'sandbag' };
            engine.scene.add(parapet);
            engine.staticShootableMeshes.push(parapet);

            const colHandle = engine.ragdollPhysics?.addStaticBoxCollider(
                parapet.position,
                { x: seg.w * 0.5, y: seg.h * 0.5, z: seg.d * 0.5 }
            );

            registerDestructible({
                mesh: parapet,
                kind: 'hesco',
                hp: 350,
                maxHp: 350,
                colliderHandle: colHandle,
                surface: 'sandbag',
                penetrable: { mm: 350, material: 'sandbag' }
            });
        }

        const duckboardMat = new THREE.MeshStandardMaterial({ color: 0x5c4228, roughness: 0.9 });
        for (let i = -10; i <= 10; i += 2.5) {
            const db = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 2.2), duckboardMat);
            db.position.set(i, 0.04, -36.0);
            db.receiveShadow = true;
            db.userData.surface = 'wood';
            db.userData.penetrable = { mm: 20, material: 'wood' };
            engine.scene.add(db);
            engine.staticShootableMeshes.push(db);

            registerDestructible({
                mesh: db,
                kind: 'duckboard',
                hp: 40,
                maxHp: 40,
                surface: 'wood',
                penetrable: { mm: 20, material: 'wood' }
            });
        }
    }

    const mod = {
        name: 'destructibles',
        damageAt,
        register: registerDestructible,

        install() {
            buildCoverWorldElements();

            engine.events.on('explosion', (ev) => {
                const radius = ev.radius || 8.0;
                const damage = ev.damage || 200;
                damageAt(ev.pos, radius, damage);
            });

            engine.events.on('impact', (ev) => {
                if (!ev.object?.userData?.destructible) return;
                const entry = registry.find((r) => r.mesh === ev.object);
                if (entry && !entry.broken) {
                    entry.hp -= ev.damage || 35;
                    if (entry.hp <= 0) {
                        _v1.copy(ev.normal ? ev.normal.clone().negate() : new THREE.Vector3(0, 1, 0));
                        if (entry.kind === 'crate') breakCrate(entry, _v1);
                        else if (entry.kind === 'hesco') breakHesco(entry, ev.pos);
                        else if (entry.kind === 'dragons_teeth') toppleDragonsTooth(entry, _v1);
                    }
                }
            });
        }
    };

    return mod;
}
