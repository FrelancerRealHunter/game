const SPEED_OF_SOUND = 343.0;
const CRACK_RANGE = 3.0;
const CONCUSSION_RANGE = 14.0;
const CONCUSSION_LP_FREQ = 380;
const TINNITUS_FREQ_LO = 4000;
const TINNITUS_FREQ_HI = 6000;
const TINNITUS_DURATION = 5.0;
const DRONE_AUDIBLE_RANGE = 80.0;

export class SoundEngine {
    constructor(engineRef) {
        this.engine = engineRef;
        this.ctx = null;
        this.noiseBuffer = null;
        this.engineNode = null;
        this.listener = null;
        this.masterGain = null;
        this.concussionLP = null;
        this.concussionGain = null;
        this.tinnitusOsc = null;
        this.tinnitusGain = null;
        this.concussionTimer = 0;
        this.maxVoices = 32;
        this.activeVoices = 0;
        this.useHrtf = true;
        this._pannerPool = [];
        this._pannerIdx = 0;
    }

    init() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return;
        }
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        const sr = this.ctx.sampleRate;

        this.noiseBuffer = this.ctx.createBuffer(1, sr * 2, sr);
        const data = this.noiseBuffer.getChannelData(0);
        let s = 0x5EED;
        for (let i = 0; i < data.length; i++) {
            s = (s + 0x6D2B79F5) >>> 0;
            let t = Math.imul(s ^ (s >>> 15), s | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            data[i] = ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
        }

        this.listener = this.ctx.listener;
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1.0;
        this.masterGain.connect(this.ctx.destination);

        this.concussionLP = this.ctx.createBiquadFilter();
        this.concussionLP.type = 'lowpass';
        this.concussionLP.frequency.value = 22000;
        this.concussionLP.connect(this.masterGain);

        this.concussionGain = this.ctx.createGain();
        this.concussionGain.gain.value = 1.0;
        this.concussionGain.connect(this.concussionLP);

        const profile = this.engine?.quality?.profile?.audio;
        if (profile) {
            this.maxVoices = profile.maxVoices || 32;
            this.useHrtf = profile.hrtf !== false;
        }

        for (let i = 0; i < 8; i++) {
            this._pannerPool.push(this._makePanner());
        }
    }

    _makePanner() {
        if (!this.ctx) return null;
        const panner = this.ctx.createPanner();
        panner.panningModel = this.useHrtf ? 'HRTF' : 'equalpower';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1;
        panner.maxDistance = 500;
        panner.rolloffFactor = 1.2;
        panner.coneInnerAngle = 360;
        panner.coneOuterAngle = 360;
        return panner;
    }

    _getPanner(x, y, z) {
        const p = this._pannerPool[this._pannerIdx % this._pannerPool.length];
        this._pannerIdx++;
        if (p && typeof p.positionX !== 'undefined') {
            p.positionX.value = x;
            p.positionY.value = y;
            p.positionZ.value = z;
        } else if (p) {
            p.setPosition(x, y, z);
        }
        return p;
    }

    _updateListener() {
        if (!this.ctx || !this.listener || !this.engine) return;
        const cam = this.engine.camera;
        if (!cam) return;
        const p = cam.getWorldPosition(new (cam.position.constructor)());
        const d = new (cam.position.constructor)(0, 0, -1).applyQuaternion(cam.quaternion);
        const u = new (cam.position.constructor)(0, 1, 0).applyQuaternion(cam.quaternion);
        if (typeof this.listener.positionX !== 'undefined') {
            this.listener.positionX.value = p.x;
            this.listener.positionY.value = p.y;
            this.listener.positionZ.value = p.z;
            this.listener.forwardX.value = d.x;
            this.listener.forwardY.value = d.y;
            this.listener.forwardZ.value = d.z;
            this.listener.upX.value = u.x;
            this.listener.upY.value = u.y;
            this.listener.upZ.value = u.z;
        } else {
            this.listener.setPosition(p.x, p.y, p.z);
            this.listener.setOrientation(d.x, d.y, d.z, u.x, u.y, u.z);
        }
    }

    _voice() {
        if (this.activeVoices >= this.maxVoices) return false;
        this.activeVoices++;
        return true;
    }

    _endVoice() {
        this.activeVoices = Math.max(0, this.activeVoices - 1);
    }

    playGunshot(distance = 0, isHeavy = false) {
        if (!this.ctx || !this.noiseBuffer) return;
        if (!this._voice()) return;
        const now = this.ctx.currentTime;
        const atten = Math.max(0.04, Math.min(1.0, 26.0 / (distance + 20.0)));
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(isHeavy ? 380 : 1250, now);
        filter.frequency.exponentialRampToValueAtTime(140, now + (isHeavy ? 0.42 : 0.17));
        filter.Q.value = 0.9;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime((isHeavy ? 1.25 : 0.78) * atten, now + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (isHeavy ? 0.46 : 0.21));

        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.concussionGain);
        src.start(now);
        src.stop(now + (isHeavy ? 0.48 : 0.23));
        src.onended = () => this._endVoice();

        const osc = this.ctx.createOscillator();
        const punchGain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(isHeavy ? 98 : 195, now);
        osc.frequency.exponentialRampToValueAtTime(28, now + 0.11);
        punchGain.gain.setValueAtTime(0.62 * atten, now);
        punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.115);
        osc.connect(punchGain);
        punchGain.connect(this.concussionGain);
        osc.start(now);
        osc.stop(now + 0.12);
    }

    playGunshotSpatial(worldX, worldY, worldZ, isHeavy, listenerDist) {
        if (!this.ctx || !this.noiseBuffer) return;
        const delay = listenerDist / SPEED_OF_SOUND;
        if (!this._voice()) return;
        const now = this.ctx.currentTime;
        const startAt = now + delay;
        const atten = Math.max(0.04, Math.min(1.0, 26.0 / (listenerDist + 20.0)));

        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(isHeavy ? 380 : 1250, startAt);
        filter.frequency.exponentialRampToValueAtTime(140, startAt + (isHeavy ? 0.42 : 0.17));
        filter.Q.value = 0.9;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.001, startAt);
        gain.gain.linearRampToValueAtTime((isHeavy ? 1.25 : 0.78) * atten, startAt + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + (isHeavy ? 0.46 : 0.21));

        const panner = this._getPanner(worldX, worldY, worldZ);

        src.connect(filter);
        filter.connect(gain);
        gain.connect(panner);
        panner.connect(this.concussionGain);
        src.start(startAt);
        src.stop(startAt + (isHeavy ? 0.48 : 0.23));
        src.onended = () => this._endVoice();
    }

    playExplosion(distance = 0) {
        if (!this.ctx || !this.noiseBuffer) return;
        if (!this._voice()) return;
        const delay = distance / SPEED_OF_SOUND;
        const now = this.ctx.currentTime;
        const startAt = now + delay;
        const atten = Math.max(0.08, Math.min(1.0, 55.0 / (distance + 18.0)));
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;

        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(540, startAt);
        lp.frequency.exponentialRampToValueAtTime(42, startAt + 1.45);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.001, startAt);
        gain.gain.linearRampToValueAtTime(1.4 * atten, startAt + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + 1.5);

        src.connect(lp);
        lp.connect(gain);
        gain.connect(this.concussionGain);
        src.start(startAt);
        src.stop(startAt + 1.55);
        src.onended = () => this._endVoice();

        if (distance < CONCUSSION_RANGE) {
            this._triggerConcussion(distance);
        }
    }

    _triggerConcussion(distance) {
        if (!this.ctx) return;
        const intensity = Math.pow(1 - distance / CONCUSSION_RANGE, 1.5);
        const now = this.ctx.currentTime;
        const duration = TINNITUS_DURATION * intensity;

        this.concussionLP.frequency.cancelScheduledValues(now);
        this.concussionLP.frequency.setValueAtTime(CONCUSSION_LP_FREQ, now);
        this.concussionLP.frequency.exponentialRampToValueAtTime(22000, now + duration);

        if (this.tinnitusOsc) {
            try { this.tinnitusOsc.stop(); } catch (_) {}
        }

        this.tinnitusOsc = this.ctx.createOscillator();
        this.tinnitusGain = this.ctx.createGain();
        this.tinnitusOsc.type = 'sine';
        const freq = TINNITUS_FREQ_LO + (TINNITUS_FREQ_HI - TINNITUS_FREQ_LO) * intensity;
        this.tinnitusOsc.frequency.value = freq;
        this.tinnitusGain.gain.setValueAtTime(0.18 * intensity, now);
        this.tinnitusGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        this.tinnitusOsc.connect(this.tinnitusGain);
        this.tinnitusGain.connect(this.masterGain);
        this.tinnitusOsc.start(now);
        this.tinnitusOsc.stop(now + duration + 0.1);
        this.concussionTimer = duration;
    }

    playSupersonicCrack(worldX, worldY, worldZ, listenerDist) {
        if (!this.ctx || listenerDist > CRACK_RANGE) return;
        if (!this._voice()) return;
        const now = this.ctx.currentTime;
        const atten = Math.max(0.1, 1 - listenerDist / CRACK_RANGE);

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(4200, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.015);
        gain.gain.setValueAtTime(0.55 * atten, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

        const panner = this._getPanner(worldX, worldY, worldZ);
        osc.connect(gain);
        gain.connect(panner);
        panner.connect(this.concussionGain);
        osc.start(now);
        osc.stop(now + 0.03);
        osc.onended = () => this._endVoice();
    }

    playHitMarker(isHeadshot = false) {
        if (!this.ctx) return;
        if (!this._voice()) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = isHeadshot ? 'sawtooth' : 'sine';
        osc.frequency.setValueAtTime(isHeadshot ? 1680 : 920, now);
        osc.frequency.exponentialRampToValueAtTime(isHeadshot ? 620 : 340, now + 0.075);
        gain.gain.setValueAtTime(0.28, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.085);
        osc.onended = () => this._endVoice();
    }

    playReloadClick(pitch = 640) {
        if (!this.ctx) return;
        if (!this._voice()) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(pitch, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.045);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.055);
        osc.onended = () => this._endVoice();
    }

    playRadioSquelch() {
        if (!this.ctx) return;
        if (!this._voice()) return;
        const now = this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2200;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 3400;
        bp.Q.value = 3.0;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        src.connect(hp);
        hp.connect(bp);
        bp.connect(gain);
        gain.connect(this.masterGain);
        src.start(now);
        src.stop(now + 0.1);
        src.onended = () => this._endVoice();
    }

    createDroneMotorNode() {
        if (!this.ctx) return null;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = 390;
        gain.gain.value = 0.0;
        osc.connect(gain);
        gain.connect(this.concussionGain);
        osc.start();
        return { osc, gain };
    }

    updateDroneAudio(droneNode, distance, speed, maxSpeed) {
        if (!droneNode || !this.ctx) return;
        if (distance > DRONE_AUDIBLE_RANGE) {
            droneNode.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
            return;
        }
        const vol = Math.max(0.01, 1 - distance / DRONE_AUDIBLE_RANGE) * 0.25;
        droneNode.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.04);

        const baseFreq = 390;
        const speedRatio = speed / Math.max(1, maxSpeed);
        const dopplerShift = 1 + speedRatio * 0.4;
        droneNode.osc.frequency.setTargetAtTime(baseFreq * dopplerShift, this.ctx.currentTime, 0.03);
    }

    updateVehicleEngineSound(active, speedKmh, throttle) {
        if (!this.ctx) return;
        if (!this.engineNode) {
            const osc = this.ctx.createOscillator();
            const filter = this.ctx.createBiquadFilter();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.value = 48;
            filter.type = 'lowpass';
            filter.frequency.value = 190;
            gain.gain.value = 0.0;
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.concussionGain);
            osc.start();

            const subOsc = this.ctx.createOscillator();
            const subGain = this.ctx.createGain();
            subOsc.type = 'triangle';
            subOsc.frequency.value = 24;
            subGain.gain.value = 0.0;
            subOsc.connect(subGain);
            subGain.connect(this.concussionGain);
            subOsc.start();

            this.engineNode = { osc, filter, gain, subOsc, subGain };
        }
        if (!active) {
            this.engineNode.gain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.08);
            this.engineNode.subGain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.08);
            return;
        }
        const rpmFreq = 46 + Math.min(85, speedKmh * 1.15 + Math.abs(throttle) * 28);
        this.engineNode.osc.frequency.setTargetAtTime(rpmFreq, this.ctx.currentTime, 0.06);
        this.engineNode.filter.frequency.setTargetAtTime(160 + rpmFreq * 2.2, this.ctx.currentTime, 0.06);
        this.engineNode.gain.gain.setTargetAtTime(0.11, this.ctx.currentTime, 0.08);

        this.engineNode.subOsc.frequency.setTargetAtTime(rpmFreq * 0.5, this.ctx.currentTime, 0.06);
        this.engineNode.subGain.gain.setTargetAtTime(0.06, this.ctx.currentTime, 0.08);
    }

    playTrackClank(worldX, worldY, worldZ) {
        if (!this.ctx || !this.noiseBuffer) return;
        if (!this._voice()) return;
        const now = this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 800;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.08, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        const panner = this._getPanner(worldX, worldY, worldZ);
        src.connect(hp);
        hp.connect(gain);
        gain.connect(panner);
        panner.connect(this.concussionGain);
        src.start(now);
        src.stop(now + 0.08);
        src.onended = () => this._endVoice();
    }

    playCasingBounce(worldX, worldY, worldZ) {
        if (!this.ctx) return;
        if (!this._voice()) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(3800 + Math.random() * 1200, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.04);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        const panner = this._getPanner(worldX, worldY, worldZ);
        osc.connect(gain);
        gain.connect(panner);
        panner.connect(this.concussionGain);
        osc.start(now);
        osc.stop(now + 0.06);
        osc.onended = () => this._endVoice();
    }

    update(dt) {
        this._updateListener();
        if (this.concussionTimer > 0) {
            this.concussionTimer -= dt;
            if (this.concussionTimer <= 0) {
                this.concussionTimer = 0;
            }
        }
    }
}
