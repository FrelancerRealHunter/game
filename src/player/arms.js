import * as THREE from 'three';
import { STATS } from '../../stats.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _target = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _cb = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _fwd = new THREE.Vector3();

const DEG = Math.PI / 180;
const DEADZONE_RAD = 2.5 * DEG;
const DEADZONE_RETURN = 8.0;
const IK_EPSILON = 1e-6;

const SIGHT_FOV_MULT = {
    ak12: 1.0,
    m4a1: 1.0,
    ak74m: 1.0,
    rpg7: 1.0 / 2.7
};

const OPTIC_TYPE = {
    ak12: 'collimator',
    m4a1: 'eotech',
    ak74m: 'irons',
    rpg7: 'pgo7v'
};

function solveTwoBoneIK(root, mid, tip, targetPos, polePos, hintDir) {
    root.updateWorldMatrix(true, false);
    if (mid.parent !== root) return;
    if (tip.parent !== mid) return;

    root.getWorldPosition(_v);
    const rootPos = _v.clone();
    mid.getWorldPosition(_v);
    const midPos = _v.clone();
    tip.getWorldPosition(_v);
    const tipPos = _v.clone();

    const lenA = rootPos.distanceTo(midPos);
    const lenB = midPos.distanceTo(tipPos);
    const lenC = Math.min(lenA + lenB - IK_EPSILON, rootPos.distanceTo(targetPos));

    if (lenA < IK_EPSILON || lenB < IK_EPSILON) return;

    const cosA = (lenA * lenA + lenC * lenC - lenB * lenB) / (2 * lenA * lenC);
    const cosB = (lenA * lenA + lenB * lenB - lenC * lenC) / (2 * lenA * lenB);
    const angleA = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const angleB = Math.acos(Math.max(-1, Math.min(1, cosB)));

    _ab.subVectors(targetPos, rootPos).normalize();

    if (polePos) {
        _cb.subVectors(polePos, rootPos);
        _cb.addScaledVector(_ab, -_cb.dot(_ab));
        if (_cb.lengthSq() > IK_EPSILON) _cb.normalize();
        else _cb.copy(hintDir || _pole.set(0, -1, 0));
    } else {
        _cb.copy(hintDir || _pole.set(0, -1, 0));
    }

    root.parent.updateWorldMatrix(true, false);
    const invParent = _m.copy(root.parent.matrixWorld).invert();

    _target.copy(_ab);
    _axis.crossVectors(_target, _cb).normalize();
    _q.setFromAxisAngle(_axis, angleA);
    _target.applyQuaternion(_q);

    const rootWorldQ = new THREE.Quaternion();
    root.parent.getWorldQuaternion(rootWorldQ);
    const rootLocalQ = rootWorldQ.clone().invert();

    const toTarget = new THREE.Quaternion().setFromUnitVectors(
        _fwd.set(0, 1, 0),
        _target
    );
    root.quaternion.copy(rootLocalQ).multiply(toTarget);
    root.updateWorldMatrix(true, false);

    const bendAngle = Math.PI - angleB;
    _axis.set(1, 0, 0);
    mid.quaternion.setFromAxisAngle(_axis, bendAngle);
    mid.updateWorldMatrix(true, false);
}

function buildReticleTexture(type) {
    const size = 128;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2;
    const cy = size / 2;

    if (type === 'collimator') {
        ctx.strokeStyle = 'rgba(255,40,40,0.92)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,40,40,0.95)';
        ctx.beginPath();
        ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
        ctx.fill();
    } else if (type === 'eotech') {
        ctx.strokeStyle = 'rgba(255,20,20,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,30,30,0.95)';
        ctx.beginPath();
        ctx.arc(cx, cy, 1.2, 0, Math.PI * 2);
        ctx.fill();
    } else if (type === 'pgo7v') {
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, size);
        ctx.moveTo(0, cy);
        ctx.lineTo(size, cy);
        ctx.stroke();
        ctx.font = '8px monospace';
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        for (let r = 1; r <= 3; r++) {
            const y = cy + r * 12;
            ctx.beginPath();
            ctx.moveTo(cx - 8, y);
            ctx.lineTo(cx + 8, y);
            ctx.stroke();
            ctx.fillText(`${r * 100}`, cx + 10, y + 3);
        }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

export function createArms(engine) {
    let armGroupL = null;
    let armGroupR = null;
    let shoulderL = null;
    let elbowL = null;
    let wristL = null;
    let shoulderR = null;
    let elbowR = null;
    let wristR = null;
    let armsReady = false;

    let deadzoneYaw = 0;
    let deadzonePitch = 0;

    let reloadPhase = 0;
    let reloadTimer = 0;
    let reloadTotal = 0;
    let switchPhase = 0;
    let switchTimer = 0;

    const reticleMeshes = {};

    function extractArmBones(root) {
        let sh = null, el = null, wr = null;
        root.traverse((o) => {
            if (!o.isBone) return;
            const n = o.name;
            if (n.includes('Arm') && !n.includes('Fore') && !sh) sh = o;
            else if (n.includes('ForeArm') && !el) el = o;
            else if (n.includes('Hand') && !n.includes('Index') && !n.includes('Thumb') && !n.includes('Middle') && !n.includes('Ring') && !n.includes('Pinky') && !wr) wr = o;
        });
        return { sh, el, wr };
    }

    function buildArmsFromModel(modelKey) {
        const template = engine.assets.getTemplate(modelKey);
        if (!template || !template.scene) return null;
        const { SkeletonUtils } = THREE;
        let clone;
        if (SkeletonUtils && typeof SkeletonUtils.clone === 'function') {
            clone = SkeletonUtils.clone(template.scene);
        } else {
            clone = template.scene.clone(true);
        }

        const cull = [];
        clone.traverse((o) => {
            if (!o.isMesh && !o.isSkinnedMesh) return;
            const n = (o.name || '').toLowerCase();
            if (n.includes('head') || n.includes('torso') || n.includes('body') || n.includes('leg') || n.includes('foot') || n.includes('hips')) {
                cull.push(o);
            }
        });
        for (const c of cull) c.removeFromParent();

        clone.traverse((o) => {
            if (o.isMesh || o.isSkinnedMesh) {
                o.frustumCulled = false;
                o.renderOrder = 100;
            }
        });

        return clone;
    }

    function setupReticle(weaponKey) {
        const optic = OPTIC_TYPE[weaponKey];
        if (!optic || optic === 'irons') return;
        if (reticleMeshes[weaponKey]) return;
        const tex = buildReticleTexture(optic);
        const mat = new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthTest: false,
            sizeAttenuation: false
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(0.015, 0.015, 1);
        sprite.visible = false;
        sprite.renderOrder = 200;
        reticleMeshes[weaponKey] = sprite;

        const wState = engine.weaponStates[weaponKey];
        if (wState && wState.meshGroup) {
            wState.meshGroup.add(sprite);
            sprite.position.set(0, 0.04, -0.12);
        }
    }

    function initArms() {
        const faction = engine.playerFaction;
        const modelKey = faction === 'RU' ? 'soldier_ru' : 'soldier_ua';
        const armModel = buildArmsFromModel(modelKey);
        if (!armModel) return;

        const armGroup = new THREE.Group();
        armGroup.add(armModel);
        engine.viewmodelRoot.add(armGroup);

        const bonesR = extractArmBones(armModel);
        shoulderR = bonesR.sh;
        elbowR = bonesR.el;
        wristR = bonesR.wr;

        let foundSecond = false;
        armModel.traverse((o) => {
            if (!o.isBone) return;
            const n = o.name;
            if (n.includes('Left')) foundSecond = true;
        });

        if (foundSecond) {
            shoulderL = null;
            elbowL = null;
            wristL = null;
            armModel.traverse((o) => {
                if (!o.isBone) return;
                const n = o.name;
                if (n.includes('LeftArm') && !n.includes('Fore') && !shoulderL) shoulderL = o;
                else if (n.includes('LeftForeArm') && !elbowL) elbowL = o;
                else if (n.includes('LeftHand') && !n.includes('Index') && !n.includes('Thumb') && !n.includes('Middle') && !n.includes('Ring') && !n.includes('Pinky') && !wristL) wristL = o;
            });
        }

        armGroupL = armGroup;
        armGroupR = armGroup;

        for (const key of engine.loadoutKeys) {
            setupReticle(key);
        }

        armsReady = true;
    }

    function updateDeadzone(dt) {
        if (!engine.isStarted) return;
        const returnRate = DEADZONE_RETURN * dt;
        deadzoneYaw *= Math.max(0, 1 - returnRate);
        deadzonePitch *= Math.max(0, 1 - returnRate);
    }

    function applyDeadzoneOffset(dx, dy) {
        const yawDelta = dx * 0.0003;
        const pitchDelta = dy * 0.0003;
        deadzoneYaw = Math.max(-DEADZONE_RAD, Math.min(DEADZONE_RAD, deadzoneYaw + yawDelta));
        deadzonePitch = Math.max(-DEADZONE_RAD, Math.min(DEADZONE_RAD, deadzonePitch + pitchDelta));
    }

    function updateReload(dt) {
        const key = engine.loadoutKeys[engine.currentWeaponIdx];
        const wState = engine.weaponStates[key];
        if (!wState.reloading) {
            reloadPhase = 0;
            reloadTimer = 0;
            return;
        }

        if (reloadPhase === 0) {
            reloadPhase = wState.reloadState === 'DRY_RELOAD' ? 2 : 1;
            reloadTotal = wState.reloadTotal;
            reloadTimer = 0;
        }

        reloadTimer += dt;
        const progress = Math.min(1, reloadTimer / reloadTotal);

        if (reloadPhase === 1) {
            const tiltX = Math.sin(progress * Math.PI) * 0.18;
            const tiltZ = Math.sin(progress * Math.PI) * 0.12;
            engine.viewmodelRoot.rotation.x += tiltX;
            engine.viewmodelRoot.rotation.z += tiltZ;
        } else if (reloadPhase === 2) {
            const magOutPhase = Math.min(1, progress * 3);
            const magInPhase = Math.max(0, (progress - 0.33) * 1.5);
            const boltPhase = Math.max(0, (progress - 0.7) * 3.33);
            const tiltX = Math.sin(magOutPhase * Math.PI * 0.5) * 0.22;
            const dropY = -Math.sin(magInPhase * Math.PI * 0.5) * 0.06;
            const boltSnap = Math.sin(boltPhase * Math.PI) * 0.08;
            engine.viewmodelRoot.rotation.x += tiltX;
            engine.viewmodelRoot.position.y += dropY;
            engine.viewmodelRoot.position.z += boltSnap;
        }

        if (key === 'rpg7' && reloadPhase > 0) {
            const slidePhase = Math.sin(progress * Math.PI) * 0.15;
            engine.viewmodelRoot.rotation.x += slidePhase;
            engine.viewmodelRoot.position.y -= slidePhase * 0.3;
        }
    }

    function updateIK() {
        if (!armsReady || !shoulderR || !elbowR || !wristR) return;

        const key = engine.loadoutKeys[engine.currentWeaponIdx];
        const wState = engine.weaponStates[key];
        if (!wState || !wState.meshGroup) return;

        const gripTarget = new THREE.Vector3();
        wState.meshGroup.getWorldPosition(gripTarget);
        gripTarget.y -= 0.02;
        gripTarget.z -= 0.08;

        _pole.set(0.15, -0.3, 0.1);
        _pole.applyQuaternion(engine.camera.quaternion);
        _pole.add(gripTarget);

        solveTwoBoneIK(shoulderR, elbowR, wristR, gripTarget, _pole, _fwd.set(0, -1, 0));

        if (shoulderL && elbowL && wristL) {
            const handguardTarget = gripTarget.clone();
            handguardTarget.z -= 0.18;
            handguardTarget.x -= 0.04;

            _pole.set(-0.15, -0.3, 0.1);
            _pole.applyQuaternion(engine.camera.quaternion);
            _pole.add(handguardTarget);

            solveTwoBoneIK(shoulderL, elbowL, wristL, handguardTarget, _pole, _fwd.set(0, -1, 0));
        }
    }

    function updateOptics() {
        const key = engine.loadoutKeys[engine.currentWeaponIdx];
        const reticle = reticleMeshes[key];
        if (reticle) {
            reticle.visible = engine.isAiming;
        }

        if (engine.isAiming) {
            const fovMult = SIGHT_FOV_MULT[key] || 1.0;
            engine.camera.fov = engine.baseFov * fovMult;
            engine.camera.updateProjectionMatrix();
        } else if (engine.camera.fov !== engine.baseFov) {
            engine.camera.fov = engine.baseFov;
            engine.camera.updateProjectionMatrix();
        }
    }

    function updateWeaponSwitch(dt) {
        if (switchPhase === 0) return;
        switchTimer += dt;
        const total = 0.45;
        const progress = Math.min(1, switchTimer / total);

        if (progress < 0.5) {
            const down = Math.sin(progress * 2 * Math.PI * 0.5);
            engine.viewmodelRoot.position.y -= down * 0.25;
            engine.viewmodelRoot.rotation.x -= down * 0.4;
        } else {
            const up = Math.sin((progress - 0.5) * 2 * Math.PI * 0.5);
            engine.viewmodelRoot.position.y -= (1 - up) * 0.08;
        }

        if (progress >= 1.0) {
            switchPhase = 0;
            switchTimer = 0;
        }
    }

    const origSwitchWeapon = engine.constructor.prototype.switchWeapon || null;

    const mod = {
        name: 'arms',

        install() {
            engine.events.on('game:started', () => {
                initArms();
            });

            engine.events.on('shot', () => {
                if (!armsReady) return;
                const key = engine.loadoutKeys[engine.currentWeaponIdx];
                const wStat = STATS.WEAPONS[key];
                const adsMult = engine.isAiming ? 0.5 : 1.0;
                if (shoulderR) {
                    shoulderR.rotation.x -= wStat.recoilPitch * 2.5 * adsMult;
                    shoulderR.rotation.z += (Math.random() - 0.5) * wStat.recoilRoll * 1.8 * adsMult;
                }
                if (elbowR) {
                    elbowR.rotation.x -= wStat.recoilKickBack * 3.2 * adsMult;
                }
            });
        },

        update(dt) {
            updateDeadzone(dt);
            updateReload(dt);
            updateWeaponSwitch(dt);
            updateIK();
            updateOptics();

            if (armsReady) {
                engine.viewmodelRoot.rotation.y += deadzoneYaw;
                engine.viewmodelRoot.rotation.x += deadzonePitch;
            }
        },

        getAimRay(outOrigin, outDir) {
            engine.camera.getWorldPosition(outOrigin);
            outDir.set(0, 0, -1).applyQuaternion(engine.camera.quaternion);
            if (Math.abs(deadzoneYaw) > 0.001 || Math.abs(deadzonePitch) > 0.001) {
                _q.setFromEuler(new THREE.Euler(deadzonePitch, deadzoneYaw, 0, 'YXZ'));
                outDir.applyQuaternion(_q);
            }
            outDir.normalize();
        },

        applyMouseDeadzone(dx, dy) {
            applyDeadzoneOffset(dx, dy);
        },

        triggerSwitch() {
            switchPhase = 1;
            switchTimer = 0;
        }
    };

    return mod;
}
