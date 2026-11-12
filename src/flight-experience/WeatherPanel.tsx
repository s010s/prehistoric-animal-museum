import type { FlightRuntime, FlightSnapshot } from './FlightRuntime'
import { WEATHER_PRESETS } from './environment/weather-controller'
import {FlightToggle} from './FlightToggle'
import {FlightChoices} from './FlightChoices'
export function WeatherPanel({runtime,snapshot,locale}:{runtime:FlightRuntime;snapshot:FlightSnapshot;locale:'en'|'zh-CN'}){
 const zh=locale==='zh-CN',w=snapshot.weather,labels=zh?['晴朗','少云','阴天','小雨']:['Clear','Clouds','Overcast','Light rain']
 return <section className="flight-light-content" aria-label={zh?'天气':'Weather'}>
 <FlightChoices selected={w?.target} className="flight-light-options flight-chips" role="group" aria-label={zh?'目标天气':'Target weather'}>{WEATHER_PRESETS.map((p,i)=><button key={p} type="button" data-flight-choice={p} aria-pressed={w?.target===p} onClick={()=>runtime.setWeather(p)}>{labels[i]}</button>)}</FlightChoices>
 {w?.status==='suspended'&&w.elapsed<w.duration&&<small role="status">{zh?'继续飞翔或景色后，天气会缓慢变化。':'Resume flight or scenery for the weather to change.'}</small>}
 <details className="flight-fine-tune"><summary>{zh?'让天气自己变化':'Let the weather change'}</summary>
 <FlightToggle label={zh?'自动天气':'Automatic weather'} checked={w?.mode==='auto'} onChange={enabled=>runtime.setWeatherMode(enabled?'auto':'fixed')}/>
 <small>{zh?'约 8 分钟一轮，偶尔有小雨。':'An eight-minute cycle, with occasional light rain.'}</small>
 </details>
 {runtime.scenery?.environment.weatherDegraded&&<p role="status">{zh?'云层素材暂不可用，正在使用简化天气。':'Cloud texture unavailable; simplified weather is active.'}</p>}
 </section>
}
