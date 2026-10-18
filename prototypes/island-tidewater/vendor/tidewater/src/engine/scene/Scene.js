// Scene root. Render-state fields (background, environment, fog, ...) are
// plain slots interpreted by the renderer.

import { Object3D } from './Object3D.js';
import { Euler } from '../math/Euler.js';

export class Scene extends Object3D {

	constructor() {

		super();
		this.type = 'Scene';
		this.background = null;
		this.environment = null;
		this.fog = null;
		this.backgroundBlurriness = 0;
		this.backgroundIntensity = 1;
		this.backgroundRotation = new Euler();
		this.environmentIntensity = 1;
		this.environmentRotation = new Euler();
		this.overrideMaterial = null;

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.background = source.background;
		this.environment = source.environment;
		this.fog = source.fog;
		this.backgroundBlurriness = source.backgroundBlurriness;
		this.backgroundIntensity = source.backgroundIntensity;
		this.backgroundRotation.copy( source.backgroundRotation );
		this.environmentRotation.copy( source.environmentRotation );
		this.environmentIntensity = source.environmentIntensity;
		this.overrideMaterial = source.overrideMaterial;
		this.matrixAutoUpdate = source.matrixAutoUpdate;
		return this;

	}

}

Scene.prototype.isScene = true;
