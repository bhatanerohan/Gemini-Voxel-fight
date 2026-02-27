import * as THREE from 'three';

export class Trail {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.max = opts.segments || 40;
    this.width = opts.width || 0.15;
    this.color = new THREE.Color(opts.color !== undefined ? opts.color : 0xffffff);
    this.fadeDuration = opts.fadeDuration || 0.5;
    this.points = [];
    this.alive = true;
    this.age = 0;
    this.fading = false;

    const count = this.max * 2;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 4);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));

    const indices = [];
    for (let i = 0; i < (this.max - 1); i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }
    this.geo.setIndex(indices);

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

  update(position) {
    if (!this.alive) return;
    this.points.unshift(position.clone());
    if (this.points.length > this.max) this.points.pop();

    const posArr = this.geo.attributes.position.array;
    const colArr = this.geo.attributes.color.array;
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < this.max; i++) {
      if (i < this.points.length) {
        const p = this.points[i];
        let tangent;
        if (i < this.points.length - 1) {
          tangent = this.points[i].clone().sub(this.points[Math.min(i + 1, this.points.length - 1)]).normalize();
        } else {
          tangent = new THREE.Vector3(0, 0, 1);
        }
        const side = new THREE.Vector3().crossVectors(tangent, up).normalize().multiplyScalar(this.width);
        if (side.length() < 0.001) side.set(this.width, 0, 0);

        const alpha = 1.0 - (i / this.max);
        const fadeAlpha = this.fading ? Math.max(0, 1 - this.age / this.fadeDuration) : 1;
        const a = alpha * fadeAlpha;

        posArr[i * 6] = p.x + side.x;
        posArr[i * 6 + 1] = p.y + side.y;
        posArr[i * 6 + 2] = p.z + side.z;
        posArr[i * 6 + 3] = p.x - side.x;
        posArr[i * 6 + 4] = p.y - side.y;
        posArr[i * 6 + 5] = p.z - side.z;

        colArr[i * 8] = this.color.r; colArr[i * 8 + 1] = this.color.g;
        colArr[i * 8 + 2] = this.color.b; colArr[i * 8 + 3] = a;
        colArr[i * 8 + 4] = this.color.r; colArr[i * 8 + 5] = this.color.g;
        colArr[i * 8 + 6] = this.color.b; colArr[i * 8 + 7] = a;
      } else {
        posArr[i * 6] = posArr[i * 6 + 1] = posArr[i * 6 + 2] = 0;
        posArr[i * 6 + 3] = posArr[i * 6 + 4] = posArr[i * 6 + 5] = 0;
        colArr[i * 8 + 3] = 0; colArr[i * 8 + 7] = 0;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
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
