import * as THREE from 'three';

export class Trail {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.max = opts.segments || 40;
    this.width = opts.width || 0.15;
    this.color = new THREE.Color(opts.color !== undefined ? opts.color : 0xffffff);
    this.fadeDuration = opts.fadeDuration || 0.5;
    this.points = [];
    this._pointPool = Array.from({ length: this.max }, () => new THREE.Vector3());
    this._up = new THREE.Vector3(0, 1, 0);
    this._fallbackTangent = new THREE.Vector3(0, 0, 1);
    this._tangent = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._visiblePointCount = 0;
    this.alive = true;
    this.age = 0;
    this.fading = false;

    const count = this.max * 2;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 4);
    this.geo = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.positionAttr);
    this.geo.setAttribute('color', this.colorAttr);

    const indices = [];
    for (let i = 0; i < (this.max - 1); i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }
    this.geo.setIndex(indices);
    this.geo.setDrawRange(0, 0);

    const colArr = this.colorAttr.array;
    for (let i = 0; i < this.max; i++) {
      const base = i * 8;
      colArr[base] = this.color.r;
      colArr[base + 1] = this.color.g;
      colArr[base + 2] = this.color.b;
      colArr[base + 4] = this.color.r;
      colArr[base + 5] = this.color.g;
      colArr[base + 6] = this.color.b;
    }

    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  getHeadPoint() {
    return this.points.length > 0 ? this.points[0] : null;
  }

  _pushPoint(position) {
    if (this.points.length < this.max) {
      this.points.push(this._pointPool[this.points.length]);
    }
    for (let i = this.points.length - 1; i > 0; i--) {
      this.points[i].copy(this.points[i - 1]);
    }
    this.points[0].copy(position);
  }

  _clearUnusedSegments(start, end) {
    const posArr = this.positionAttr.array;
    const colArr = this.colorAttr.array;
    for (let i = start; i < end; i++) {
      const posBase = i * 6;
      posArr[posBase] = posArr[posBase + 1] = posArr[posBase + 2] = 0;
      posArr[posBase + 3] = posArr[posBase + 4] = posArr[posBase + 5] = 0;
      const colBase = i * 8;
      colArr[colBase + 3] = 0;
      colArr[colBase + 7] = 0;
    }
  }

  update(position) {
    if (!this.alive) return;
    this._pushPoint(position);

    const pointCount = this.points.length;
    const posArr = this.positionAttr.array;
    const colArr = this.colorAttr.array;
    const fadeAlpha = this.fading ? Math.max(0, 1 - this.age / this.fadeDuration) : 1;

    for (let i = 0; i < pointCount; i++) {
      const p = this.points[i];
      if (i < pointCount - 1) {
        this._tangent.copy(p).sub(this.points[i + 1]);
        if (this._tangent.lengthSq() > 1e-8) this._tangent.normalize();
        else this._tangent.copy(this._fallbackTangent);
      } else {
        this._tangent.copy(this._fallbackTangent);
      }
      this._side.crossVectors(this._tangent, this._up);
      if (this._side.lengthSq() > 1e-8) this._side.normalize().multiplyScalar(this.width);
      else this._side.set(this.width, 0, 0);

      const alpha = (1 - (i / this.max)) * fadeAlpha;
      const posBase = i * 6;
      posArr[posBase] = p.x + this._side.x;
      posArr[posBase + 1] = p.y + this._side.y;
      posArr[posBase + 2] = p.z + this._side.z;
      posArr[posBase + 3] = p.x - this._side.x;
      posArr[posBase + 4] = p.y - this._side.y;
      posArr[posBase + 5] = p.z - this._side.z;

      const colBase = i * 8;
      colArr[colBase + 3] = alpha;
      colArr[colBase + 7] = alpha;
    }

    if (pointCount < this._visiblePointCount) {
      this._clearUnusedSegments(pointCount, this._visiblePointCount);
    }
    this._visiblePointCount = pointCount;
    this.geo.setDrawRange(0, Math.max(0, (pointCount - 1) * 6));
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  startFade() {
    this.fading = true;
    this.age = 0;
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}
