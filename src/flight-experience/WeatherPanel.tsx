import type { FlightRuntime, FlightSnapshot } from './FlightRuntime'
import { WEATHER_PRESETS } from './environment/weather-controller'
export function WeatherPanel({runtime,snapshot,locale}:{runtime:FlightRuntime;snapshot:FlightSnapshot;locale:'en'|'zh-CN'}){
 const zh=locale==='zh-CN',w=snapshot.weather,labels=zh?['晴朗','少云','阴天','小雨']:['Clear','Some clouds','Overcast','Light rain']
 const pending=!!w&&w.elapsed<w.duration
 const targetLabel=w?.target?labels[WEATHER_PRESETS.indexOf(w.target)]:''
 const status=w?.status==='suspended'?(zh?'已暂停，继续后平滑切换':'Paused; transitions resume with the scenery'):w?.status==='transitioning'?(zh?'天气正在逐渐变化':'Weather is changing gradually'):(zh?'天气稳定':'Weather is steady')
 return <section className="flight-light-content" aria-label={zh?'天气':'Weather'}>
 <div className="flight-light-options" role="group" aria-label={zh?'目标天气':'Target weather'}>{WEATHER_PRESETS.map((p,i)=><button key={p} type="button" aria-pressed={w?.target===p} onClick={()=>runtime.setWeather(p)}>{labels[i]}</button>)}</div>
 <div className="flight-light-options"><button type="button" aria-pressed={w?.mode!=='auto'} onClick={()=>runtime.setWeatherMode('fixed')}>{zh?'固定天气':'Fixed weather'}</button><button type="button" aria-pressed={w?.mode==='auto'} onClick={()=>runtime.setWeatherMode('auto')}>{zh?'自动天气（含小雨）':'Automatic weather (includes rain)'}</button></div>
 <small>{zh?'自动变化一轮约8分钟。阳光单独控制，手动选择天气会关闭自动天气。':'A weather cycle takes about 8 minutes. Sunlight is independent; choosing weather manually turns off automatic weather.'}</small>
 <p role="status">{pending&&targetLabel?(zh?`目标：${targetLabel}，尚未切换完成。`:`Target: ${targetLabel}; transition incomplete. `):''}{status}{w?.target===null?(zh?' · 当前自定天气':' · Custom weather'):''}</p>
 {(w?.wetness??0)>.05&&(w?.resolved.rain??0)<.02&&<small>{zh?'雨已停，地面正在慢慢变干。':'The rain has stopped; the ground is drying slowly.'}</small>}
 {runtime.scenery?.environment.weatherDegraded&&<p role="status">{zh?'云层素材暂不可用，正在使用简化天气。':'Cloud texture unavailable; simplified weather is active.'}</p>}
 </section>
}
