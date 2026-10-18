// Spherical coordinates: phi from +Y, theta around Y from +Z (three.js convention).

export class Spherical {

	constructor( radius = 1, phi = 0, theta = 0 ) {

		this.radius = radius;
		this.phi = phi;
		this.theta = theta;

	}

	set( r, phi, theta ) { this.radius = r; this.phi = phi; this.theta = theta; return this; }
	copy( s ) { return this.set( s.radius, s.phi, s.theta ); }
	clone() { return new Spherical().copy( this ); }

	makeSafe() {

		const EPS = 0.000001;
		this.phi = Math.max( EPS, Math.min( Math.PI - EPS, this.phi ) );
		return this;

	}

	setFromVector3( v ) { return this.setFromCartesianCoords( v.x, v.y, v.z ); }

	setFromCartesianCoords( x, y, z ) {

		this.radius = Math.sqrt( x * x + y * y + z * z );
		if ( this.radius === 0 ) { this.theta = 0; this.phi = 0; } else {

			this.theta = Math.atan2( x, z );
			this.phi = Math.acos( Math.max( - 1, Math.min( 1, y / this.radius ) ) );

		}

		return this;

	}

}
