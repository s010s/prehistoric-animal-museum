import { FISH } from './FishTable.js';

// Line-tension fight. Hold to reel: the line shortens and the tension climbs; let go and it eases
// off, but a running fish then takes line. Keep the tension in the green band: the fish tires there
// fastest. Too much tension (above the line's strength for about half a second) snaps it; too little
// for too long and the hook falls out. Every few seconds the fish surges: ease off or it breaks you.
//
//   const g = new CatchMinigame( { species, kg, lineKg, reelSpeed, distance, rng } )
//   g.update( dt, reeling ) -> 'fighting' | 'caught' | 'snapped' | 'escaped'
//   g.tension (0..1+, 1 = breaking point), g.distance (m), g.stamina (0..1), g.surge (0..1),
//   g.band = [ lo, hi ] (the green band)
export class CatchMinigame {

	constructor( { species, kg, lineKg = 7, reelSpeed = 1.1, distance = 15, rng = Math.random } ) {

		const f = FISH[ species ];
		this.species = species;
		this.kg = kg;
		this.rng = rng;
		this.reelSpeed = reelSpeed;
		// pull relative to the line: a fish near the line rating is hard, one far above it is a lottery
		this.power = Math.min( 2.2, ( 0.25 + 0.75 * f.fight ) * Math.pow( kg / Math.max( lineKg * 0.5, 0.2 ), 0.55 ) );
		this.staminaMax = f.stamina * Math.pow( Math.max( kg / f.kg[ 1 ], 0.15 ), 0.35 );
		this.stamina = 1;
		this.distance = distance;
		this.maxDistance = Math.max( 60, distance + 40 ); // spooled: the fish takes all the line
		this.tension = 0.3;
		this.surge = 0;
		this.slack = 0;
		this.time = 0;
		this.band = [ 0.3, 0.85 ];
		this.overload = 0; // seconds above the breaking point: the line snaps only if it's held there
		this._nextSurge = 1.2 + rng() * 2;
		this._surgeT = 0;
		this.state = 'fighting';

	}

	update( dt, reeling ) {

		if ( this.state !== 'fighting' ) return this.state;
		this.time += dt;
		const tired = 1 - this.stamina; // 0 fresh .. 1 exhausted

		// surges: sudden runs, rarer and weaker as the fish tires
		this._nextSurge -= dt;
		if ( this._nextSurge <= 0 && this._surgeT <= 0 ) {

			this._surgeT = 0.8 + this.rng() * 1.2 * ( 1 - tired * 0.6 );
			this._nextSurge = ( 2 + this.rng() * 3 ) * ( 1 + tired );

		}

		this._surgeT -= dt;
		const surgeTarget = this._surgeT > 0 ? 1 : 0;
		this.surge += ( surgeTarget - this.surge ) * ( 1 - Math.exp( - dt * 6 ) );

		// the fish's pull (0..~1.6) and the tension it and the reel make
		const pull = this.power * ( 0.35 + 0.65 * this.surge ) * ( 1 - 0.65 * tired );
		const target = reeling ? 0.25 + pull * 0.95 + 0.25 : pull * 0.72;
		const rate = reeling ? 2.2 : 3.0;
		this.tension += ( target - this.tension ) * ( 1 - Math.exp( - dt * rate ) );

		// line in / out
		if ( reeling ) this.distance -= this.reelSpeed * dt * ( 1.15 - 0.6 * this.surge * ( 1 - tired ) );
		else this.distance += pull * 1.4 * dt;
		this.distance = Math.max( 0, this.distance );

		// tiring: fastest in the band, slowly otherwise
		const inBand = this.tension >= this.band[ 0 ] && this.tension <= this.band[ 1 ];
		this.stamina = Math.max( 0, this.stamina - dt / this.staminaMax * ( inBand ? 1 : 0.3 ) );

		// outcomes
		this.overload = this.tension > 1 ? this.overload + dt : Math.max( 0, this.overload - dt * 2 );
		if ( this.overload > 0.45 ) this.state = 'snapped';
		else {

			this.slack = this.tension < 0.12 ? this.slack + dt : Math.max( 0, this.slack - dt * 2 );
			if ( this.slack > 4 || this.distance > this.maxDistance ) this.state = 'escaped';
			else if ( this.distance < 1.2 ) this.state = 'caught';

		}

		return this.state;

	}

}
