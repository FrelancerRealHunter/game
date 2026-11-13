import * as THREE from 'three';

const MAX_PARTICLES = 16384;
const ATLAS_SIZE = 512;
const ATLAS_CELLS = 4;
const CELL_SIZE = ATLAS_SIZE / ATLAS_CELLS;

const PARTICLE_VERTEX = `
attribute vec3 aOffset;
attribute vec4 aVelLife;
attribute vec4 aSizeRotFrame;
varying vec2 vUv;
varying float vLife;
varying float vFrame;
uniform float uTime;

void main() {
    float life = aVelLife.w;
    vLife = life;
    vFrame = aSizeRotFrame.w;
    float size = aSizeRotFrame.x * (1.0 - life * 0.3);
    float rot = aSizeRotFrame.y + life * aSizeRotFrame.z;
    float c = cos(rot);
    float s = sin(rot);
    vec2 p = position.xy;
    vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c) * size;
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 worldPos = aOffset + camRight * rp.x + camUp * rp.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
    vUv = uv;
}`;

const PARTICLE_FRAGMENT = `
varying vec2 vUv;
varying float vLife;
varying float vFrame;
uniform sampler2D uAtlas;
uniform float uCells;

void main() {
    float frame = floor(vFrame);
    float row = floor(frame / uCells);
    float col = frame - row * uCells;
    vec2 cell = (vec2(col, row) + vUv) / uCells;
    vec4 tex = texture2D(uAtlas, cell);
    float alpha = tex.a * (1.0 - smoothstep(0.7, 1.0, vLife));
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(tex.rgb, alpha);
}`;

function generateAtlas() {
    const canvas = new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

    function drawCell(col, row, fn) {
        ctx.save();
        ctx.translate(col * CELL_SIZE, row * CELL_SIZE);
        fn(ctx, CELL_SIZE);
        ctx.restore();
    }

    drawCell(0, 0, (c, s) => {
        const cx = s / 2, cy = s / 2, r = s * 0.42;
        const grad = c.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, 'rgba(220,210,195,0.85)');
        grad.addColorStop(0.5, 'rgba(160,150,140,0.55)');
        grad.addColorStop(1, 'rgba(80,80,80,0)');
        c.fillStyle = grad;
        c.fillRect(0, 0, s, s);
    });

    drawCell(1, 0, (c, s) => {
        const cx = s / 2, cy = s / 2, r = s * 0.38;
        const grad = c.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, 'rgba(255,200,60,0.95)');
        grad.addColorStop(0.35, 'rgba(255,120,20,0.8)');
        grad.addColorStop(0.7, 'rgba(180,40,5,0.4)');
        grad.addColorStop(1, 'rgba(40,10,0,0)');
        c.fillStyle = grad;
        c.fillRect(0, 0, s, s);
    });

    drawCell(2, 0, (c, s) => {
        const cx = s / 2, cy = s / 2;
        c.strokeStyle = 'rgba(255,220,140,0.9)';
        c.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const len = s * 0.35 + Math.random() * s * 0.1;
            c.beginPath();
            c.moveTo(cx, cy);
            c.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
            c.stroke();
        }
    });

    drawCell(3, 0, (c, s) => {
        const cx = s / 2, cy = s / 2, r = s * 0.4;
        const grad = c.createRadialGradient(cx, cy, r * 0.6, cx, cy, r);
        grad.addColorStop(0, 'rgba(140,20,20,0.8)');
        grad.addColorStop(0.5, 'rgba(100,10,10,0.4)');
        grad.addColorStop(1, 'rgba(60,5,5,0)');
        c.fillStyle = grad;
        c.fillRect(0, 0, s, s);
    });

    drawCell(0, 1, (c, s) => {
        const cx = s / 2, cy = s / 2, r = s * 0.48;
        const grad = c.createRadialGradient(cx, cy, r * 0.85, cx, cy, r);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.4, 'rgba(255,240,200,0.4)');
        grad.addColorStop(1, 'rgba(255,220,160,0)');
        c.fillStyle = grad;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.fill();
    });

    drawCell(1, 1, (c, s) => {
        const cx = s / 2, cy = s / 2, r = s * 0.44;
        const grad = c.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, 'rgba(90,75,55,0.75)');
        grad.addColorStop(0.6, 'rgba(65,55,40,0.45)');
        grad.addColorStop(1, 'rgba(40,35,25,0)');
        c.fillStyle = grad;
        c.fillRect(0, 0, s, s);
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

const FRAME_SMOKE = 0;
const FRAME_FLAME = 1;
const FRAME_SPARK = 2;
const FRAME_BLOOD = 3;
const FRAME_SHOCKWAVE = 4;
const FRAME_DUST = 5;

export function createVfx(engine) {
    const scene = engine.scene;
    let atlas = null;
    let geo = null;
    let mat = null;
    let mesh = null;

    const pos = new Float32Array(MAX_PARTICLES * 3);
    const velLife = new Float32Array(MAX_PARTICLES * 4);
    const sizeRotFrame = new Float32Array(MAX_PARTICLES * 4);
    let head = 0;
    let count = 0;
    let budget = 9000;

    const _rng = (() => {
        let s = 0xDEAD;
        return () => {
            s = (s + 0x6D2B79F5) >>> 0;
            let t = Math.imul(s ^ (s >>> 15), s | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    })();

    function init() {
        budget = engine.quality?.profile?.particles?.budget ?? 9000;
        atlas = generateAtlas();
        const quadGeo = new THREE.PlaneGeometry(1, 1);

        geo = new THREE.InstancedBufferGeometry();
        geo.index = quadGeo.index;
        geo.setAttribute('position', quadGeo.getAttribute('position'));
        geo.setAttribute('uv', quadGeo.getAttribute('uv'));
        geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aVelLife', new THREE.InstancedBufferAttribute(velLife, 4).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aSizeRotFrame', new THREE.InstancedBufferAttribute(sizeRotFrame, 4).setUsage(THREE.DynamicDrawUsage));
        geo.instanceCount = 0;

        mat = new THREE.ShaderMaterial({
            vertexShader: PARTICLE_VERTEX,
            fragmentShader: PARTICLE_FRAGMENT,
            uniforms: {
                uAtlas: { value: atlas },
                uCells: { value: ATLAS_CELLS },
                uTime: { value: 0 }
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.name = 'vfx_particles';
        scene.add(mesh);
    }

    function emit(x, y, z, vx, vy, vz, size, rot, rotSpeed, frame, life) {
        if (count >= budget) return;
        const i = (head + count) % MAX_PARTICLES;
        const o3 = i * 3;
        const o4 = i * 4;
        pos[o3] = x;
        pos[o3 + 1] = y;
        pos[o3 + 2] = z;
        velLife[o4] = vx;
        velLife[o4 + 1] = vy;
        velLife[o4 + 2] = vz;
        velLife[o4 + 3] = 0;
        sizeRotFrame[o4] = size;
        sizeRotFrame[o4 + 1] = rot;
        sizeRotFrame[o4 + 2] = rotSpeed;
        sizeRotFrame[o4 + 3] = frame;
        count++;
    }

    function step(dt) {
        if (!mesh) return;
        const gravity = -9.81;
        const windX = engine.wind ? engine.wind.x : 0;
        const windZ = engine.wind ? engine.wind.z : 0;

        let alive = 0;
        for (let k = 0; k < count; k++) {
            const i = (head + k) % MAX_PARTICLES;
            const o3 = i * 3;
            const o4 = i * 4;
            const frame = sizeRotFrame[o4 + 3];
            const isSmoke = frame === FRAME_SMOKE || frame === FRAME_DUST;
            const isSpark = frame === FRAME_SPARK;

            velLife[o4 + 3] += dt;

            velLife[o4] += windX * dt * 0.3;
            velLife[o4 + 2] += windZ * dt * 0.3;
            if (isSpark) velLife[o4 + 1] += gravity * dt;
            else if (isSmoke) velLife[o4 + 1] += 1.8 * dt;

            velLife[o4] *= (1 - dt * 1.5);
            velLife[o4 + 1] *= (1 - dt * (isSmoke ? 0.8 : 1.5));
            velLife[o4 + 2] *= (1 - dt * 1.5);

            pos[o3] += velLife[o4] * dt;
            pos[o3 + 1] += velLife[o4 + 1] * dt;
            pos[o3 + 2] += velLife[o4 + 2] * dt;

            if (pos[o3 + 1] < 0.02 && isSpark) {
                pos[o3 + 1] = 0.02;
                velLife[o4 + 1] *= -0.3;
                velLife[o4] *= 0.6;
                velLife[o4 + 2] *= 0.6;
            }

            const life = velLife[o4 + 3];
            const maxLife = isSmoke ? 3.5 : (isSpark ? 1.5 : 2.0);
            if (life < maxLife) alive++;
        }

        let removed = count - alive;
        while (removed > 0 && count > 0) {
            const i = head % MAX_PARTICLES;
            const o4 = i * 4;
            const frame = sizeRotFrame[o4 + 3];
            const isSmoke = frame === FRAME_SMOKE || frame === FRAME_DUST;
            const isSpark = frame === FRAME_SPARK;
            const maxLife = isSmoke ? 3.5 : (isSpark ? 1.5 : 2.0);
            if (velLife[o4 + 3] >= maxLife) {
                head = (head + 1) % MAX_PARTICLES;
                count--;
                removed--;
            } else {
                break;
            }
        }

        geo.instanceCount = count;
        geo.attributes.aOffset.needsUpdate = true;
        geo.attributes.aVelLife.needsUpdate = true;
        geo.attributes.aSizeRotFrame.needsUpdate = true;
        mat.uniforms.uTime.value += dt;
    }

    function explosion(epicenter, opts = {}) {
        const x = epicenter.x, y = epicenter.y, z = epicenter.z;
        const r = opts.radius || 8;
        const rnd = _rng;
        const emission = engine.quality?.profile?.particles?.emission ?? 1.0;

        const coreCount = Math.ceil(14 * emission);
        for (let i = 0; i < coreCount; i++) {
            const spd = 2.0 + rnd() * 4.0;
            const ax = (rnd() - 0.5) * 2, ay = rnd() * 1.5 + 1.0, az = (rnd() - 0.5) * 2;
            emit(x + (rnd() - 0.5) * 0.5, y + rnd() * 0.8, z + (rnd() - 0.5) * 0.5,
                ax * spd, ay * spd, az * spd,
                1.2 + rnd() * 2.5, rnd() * 6.28, (rnd() - 0.5) * 3, FRAME_FLAME, 0);
        }

        const smokeCount = Math.ceil(22 * emission);
        for (let i = 0; i < smokeCount; i++) {
            const spd = 1.5 + rnd() * 3.5;
            const ax = (rnd() - 0.5) * 2, ay = 1.5 + rnd() * 2.5, az = (rnd() - 0.5) * 2;
            emit(x + (rnd() - 0.5), y + rnd() * 0.4, z + (rnd() - 0.5),
                ax * spd, ay * spd, az * spd,
                2.0 + rnd() * 3.5, rnd() * 6.28, (rnd() - 0.5) * 1.5, FRAME_SMOKE, 0);
        }

        const shrapnelCount = Math.ceil(18 * emission);
        for (let i = 0; i < shrapnelCount; i++) {
            const spd = 8 + rnd() * 16;
            const ax = (rnd() - 0.5) * 2, ay = rnd() * 1.2 + 0.3, az = (rnd() - 0.5) * 2;
            const len = Math.hypot(ax, ay, az) || 1;
            emit(x, y + 0.3, z,
                (ax / len) * spd, (ay / len) * spd, (az / len) * spd,
                0.08 + rnd() * 0.15, rnd() * 6.28, (rnd() - 0.5) * 20, FRAME_SPARK, 0);
        }

        const dustCount = Math.ceil(12 * emission);
        for (let i = 0; i < dustCount; i++) {
            const ang = rnd() * Math.PI * 2;
            const spd = 3 + rnd() * r * 0.6;
            emit(x + Math.cos(ang) * 0.5, y + 0.05, z + Math.sin(ang) * 0.5,
                Math.cos(ang) * spd, 0.3 + rnd() * 0.5, Math.sin(ang) * spd,
                3.0 + rnd() * 4.0, rnd() * 6.28, (rnd() - 0.5) * 0.5, FRAME_DUST, 0);
        }
    }

    function muzzleFlash(position, direction, isHeavy) {
        const rnd = _rng;
        const emission = engine.quality?.profile?.particles?.emission ?? 1.0;
        const x = position.x, y = position.y, z = position.z;
        const dx = direction.x, dy = direction.y, dz = direction.z;
        const scale = isHeavy ? 3.0 : 1.0;

        const gasCount = Math.ceil((isHeavy ? 8 : 4) * emission);
        for (let i = 0; i < gasCount; i++) {
            const spd = (6 + rnd() * 8) * scale;
            emit(x, y, z,
                dx * spd + (rnd() - 0.5) * 3, dy * spd + (rnd() - 0.5) * 2, dz * spd + (rnd() - 0.5) * 3,
                (0.15 + rnd() * 0.25) * scale, rnd() * 6.28, (rnd() - 0.5) * 12, FRAME_FLAME, 0);
        }

        const starCount = Math.ceil((isHeavy ? 6 : 3) * emission);
        for (let i = 0; i < starCount; i++) {
            const spd = (12 + rnd() * 20) * scale;
            const rx = (rnd() - 0.5) * 6, ry = (rnd() - 0.5) * 4, rz = (rnd() - 0.5) * 6;
            emit(x, y, z,
                dx * spd + rx, dy * spd + ry, dz * spd + rz,
                0.04 + rnd() * 0.08, rnd() * 6.28, (rnd() - 0.5) * 25, FRAME_SPARK, 0);
        }
    }

    function blood(opts) {
        const p = opts.pos;
        const d = opts.dir;
        const rnd = _rng;
        const amount = opts.amount || 1;
        const emission = engine.quality?.profile?.particles?.emission ?? 1.0;

        const mistCount = Math.ceil(6 * amount * emission);
        for (let i = 0; i < mistCount; i++) {
            const spd = 1.5 + rnd() * 3;
            emit(p.x, p.y, p.z,
                -d.x * spd + (rnd() - 0.5) * 2, rnd() * 2, -d.z * spd + (rnd() - 0.5) * 2,
                0.3 + rnd() * 0.5, rnd() * 6.28, (rnd() - 0.5) * 2, FRAME_BLOOD, 0);
        }

        if (opts.exit !== false) {
            const exitCount = Math.ceil(8 * amount * emission);
            for (let i = 0; i < exitCount; i++) {
                const spd = 3 + rnd() * 6;
                emit(p.x, p.y, p.z,
                    d.x * spd + (rnd() - 0.5) * 3, d.y * spd + rnd() * 2, d.z * spd + (rnd() - 0.5) * 3,
                    0.06 + rnd() * 0.12, rnd() * 6.28, (rnd() - 0.5) * 15, FRAME_SPARK, 0);
            }
        }
    }

    function rpgBackblast(position, direction) {
        const rnd = _rng;
        const emission = engine.quality?.profile?.particles?.emission ?? 1.0;
        const x = position.x, y = position.y, z = position.z;
        const bx = -direction.x, by = -direction.y, bz = -direction.z;

        const gasCount = Math.ceil(16 * emission);
        for (let i = 0; i < gasCount; i++) {
            const spd = 12 + rnd() * 18;
            const spread = 0.25 + rnd() * 0.35;
            emit(x + bx * 0.3, y + by * 0.3, z + bz * 0.3,
                bx * spd + (rnd() - 0.5) * spd * spread,
                by * spd + (rnd() - 0.5) * spd * spread + 1.0,
                bz * spd + (rnd() - 0.5) * spd * spread,
                0.6 + rnd() * 1.2, rnd() * 6.28, (rnd() - 0.5) * 8, FRAME_SMOKE, 0);
        }

        const dustCount = Math.ceil(10 * emission);
        for (let i = 0; i < dustCount; i++) {
            const spd = 4 + rnd() * 10;
            emit(x + bx * 0.5, y + 0.05, z + bz * 0.5,
                bx * spd + (rnd() - 0.5) * 4, rnd() * 1.5, bz * spd + (rnd() - 0.5) * 4,
                1.5 + rnd() * 2.5, rnd() * 6.28, (rnd() - 0.5) * 2, FRAME_DUST, 0);
        }
    }

    function armorRicochet(position, normal) {
        const rnd = _rng;
        const emission = engine.quality?.profile?.particles?.emission ?? 1.0;
        const sparkCount = Math.ceil(14 * emission);
        for (let i = 0; i < sparkCount; i++) {
            const spd = 6 + rnd() * 14;
            const rx = normal.x * spd + (rnd() - 0.5) * 8;
            const ry = normal.y * spd + rnd() * 4;
            const rz = normal.z * spd + (rnd() - 0.5) * 8;
            emit(position.x, position.y, position.z,
                rx, ry, rz,
                0.04 + rnd() * 0.08, rnd() * 6.28, (rnd() - 0.5) * 30, FRAME_SPARK, 0);
        }
    }

    function vehicleFire(position, intensity) {
        const rnd = _rng;
        const emission = engine.quality?.profile?.particles?.emission ?? 1.0;
        const x = position.x, y = position.y, z = position.z;

        const flameCount = Math.ceil(4 * intensity * emission);
        for (let i = 0; i < flameCount; i++) {
            emit(x + (rnd() - 0.5) * 1.2, y + 1.5 + rnd() * 0.6, z + (rnd() - 0.5) * 1.2,
                (rnd() - 0.5) * 1.5, 2 + rnd() * 3, (rnd() - 0.5) * 1.5,
                0.8 + rnd() * 1.5, rnd() * 6.28, (rnd() - 0.5) * 2, FRAME_FLAME, 0);
        }

        const smokeCount = Math.ceil(3 * intensity * emission);
        for (let i = 0; i < smokeCount; i++) {
            emit(x + (rnd() - 0.5) * 1.5, y + 2.0 + rnd(), z + (rnd() - 0.5) * 1.5,
                (rnd() - 0.5) * 0.8, 3 + rnd() * 2, (rnd() - 0.5) * 0.8,
                3.0 + rnd() * 5.0, rnd() * 6.28, (rnd() - 0.5) * 0.8, FRAME_SMOKE, 0);
        }
    }

    function smokeScreen(position, radius) {
        const rnd = _rng;
        const emission = engine.quality?.profile?.particles?.emission ?? 1.0;
        const puffCount = Math.ceil(40 * emission);
        for (let i = 0; i < puffCount; i++) {
            const ang = rnd() * Math.PI * 2;
            const dist = rnd() * radius;
            const x = position.x + Math.cos(ang) * dist;
            const z = position.z + Math.sin(ang) * dist;
            emit(x, position.y + rnd() * 2, z,
                (rnd() - 0.5) * 1.5, 0.5 + rnd(), (rnd() - 0.5) * 1.5,
                4 + rnd() * 6, rnd() * 6.28, (rnd() - 0.5) * 0.3, FRAME_SMOKE, 0);
        }
    }

    function spentCasing(position, rightVec, playerVel) {
        const rnd = _rng;
        const spd = 3.4 + rnd() * 1.4;
        emit(position.x, position.y, position.z,
            rightVec.x * spd + (playerVel ? playerVel.x : 0),
            rightVec.y * spd + 2 + rnd(),
            rightVec.z * spd + (playerVel ? playerVel.z : 0),
            0.025, rnd() * 6.28, (rnd() - 0.5) * 18, FRAME_SPARK, 0);
    }

    function tracer(start, end, color) {
        const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
        const len = Math.hypot(dx, dy, dz);
        if (len < 0.5) return;
        const steps = Math.min(12, Math.ceil(len / 8));
        for (let i = 0; i < steps; i++) {
            const t = i / steps;
            emit(start.x + dx * t, start.y + dy * t, start.z + dz * t,
                dx * 0.1, dy * 0.1, dz * 0.1,
                0.06, 0, 0, FRAME_SPARK, 0);
        }
    }

    const mod = {
        name: 'vfx',
        explosion,
        muzzleFlash,
        blood,
        rpgBackblast,
        armorRicochet,
        vehicleFire,
        smokeScreen,
        spentCasing,
        tracer,

        install() {
            init();
            engine.events.on('quality:changed', () => {
                budget = engine.quality?.profile?.particles?.budget ?? 9000;
            });
        },

        update(dt) {
            step(dt);
        }
    };

    return mod;
}
