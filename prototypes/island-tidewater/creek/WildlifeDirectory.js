const mediumNames = {ground:'陆地', air:'空中', freshwater:'淡水', marine:'海水', benthic:'水底'};
const nearbyLimit = 1000;

export function wildlifeDistance(metres) {
  if (metres >= 1000) return (metres / 1000).toFixed(1) + ' 公里';
  if (metres < 1) return Math.round(metres * 100) + ' 厘米';
  return Math.round(metres) + ' 米';
}

export class WildlifeDirectory {
  constructor({getEntries, track, travel}) {
    this.getEntries = getEntries;
    this.track = track;
    this.travel = travel;
    this.modal = document.querySelector('#wildlife-directory');
    this.opener = document.querySelector('#wildlife-open');
    this.search = this.modal.querySelector('#wildlife-search');
    this.medium = this.modal.querySelector('#wildlife-medium');
    this.list = this.modal.querySelector('#wildlife-results');
    this.status = this.modal.querySelector('#wildlife-count');
    this.scopes = [...this.modal.querySelectorAll('[data-wildlife-scope]')];
    this.scope = 'near';
    this.searching = false;
    this.restoreNearby = false;
    this.entries = [];
    this.opener.onclick = event => {
      const touchFirst = window.matchMedia('(pointer: coarse)').matches;
      this.open(event.pointerType !== 'touch' && (!touchFirst || event.detail === 0));
    };
    this.modal.querySelector('#wildlife-close').onclick = () => this.modal.close();
    this.modal.onkeydown = this.modal.onkeyup = event => event.stopPropagation();
    this.search.oninput = () => {
      const hasQuery = Boolean(this.query);
      if (hasQuery && !this.searching && this.scope === 'near') {
        this.scope = 'all';
        this.restoreNearby = true;
      } else if (!hasQuery && this.restoreNearby) {
        this.scope = 'near';
        this.restoreNearby = false;
      }
      this.searching = hasQuery;
      this.render();
    };
    this.medium.onchange = () => this.render();
    for (const button of this.scopes) {
      button.onclick = () => {
        this.scope = button.dataset.wildlifeScope;
        this.restoreNearby = false;
        this.render();
      };
    }
  }

  get query() {
    return this.search.value.normalize('NFKC').trim().toLowerCase();
  }

  open(focusSearch) {
    if (this.modal.open || this.opener.disabled) return;
    if (document.pointerLockElement) document.exitPointerLock();
    this.entries = this.getEntries().map(entry => {
      const category = mediumNames[entry.medium] ?? '';
      const habitat = entry.habitat ?? category;
      const keywords = [entry.title, entry.englishName, habitat, category].join(' ').normalize('NFKC').toLowerCase();
      return {...entry, habitat, keywords};
    });
    this.entries.sort((a, b) => a.distance - b.distance || a.title.localeCompare(b.title, 'zh-CN'));
    this.render();
    this.modal.showModal();
    if (focusSearch) {
      this.search.focus({preventScroll:true});
      this.search.select();
    }
  }

  render() {
    const query = this.query;
    const medium = this.medium.value;
    const all = this.scope === 'all';
    for (const button of this.scopes) {
      button.setAttribute('aria-pressed', String(button.dataset.wildlifeScope === this.scope));
    }
    const entries = this.entries.filter(entry =>
      (all || entry.horizontalDistance <= nearbyLimit) &&
      (!medium || medium === entry.medium) &&
      (!query || entry.keywords.includes(query))
    );
    const notice = query || medium ? '没有匹配的动物' : '1 公里内没有馆藏动物';
    this.status.textContent = entries.length ? entries.length + ' 种' : notice;
    const rows = document.createDocumentFragment();
    for (const entry of entries) {
      const row = document.createElement('li');
      const follow = document.createElement('button');
      follow.className = 'wildlife-follow';
      follow.type = 'button';
      follow.setAttribute('aria-label', '寻踪' + entry.title);
      follow.setAttribute('aria-describedby', 'wildlife-habitat-' + entry.speciesId);
      follow.onclick = () => {
        if (this.track(entry.speciesId)) this.modal.close();
      };
      const heading = document.createElement('strong');
      heading.textContent = entry.title;
      const detail = document.createElement('span');
      detail.id = 'wildlife-habitat-' + entry.speciesId;
      const distance = Number.isFinite(entry.distance) ? (entry.live ? '' : '约 ') + wildlifeDistance(entry.distance) : '';
      detail.textContent = [entry.habitat, distance].filter(Boolean).join(' · ');
      const action = document.createElement('small');
      action.textContent = '寻踪';
      action.setAttribute('aria-hidden', 'true');
      follow.append(heading, detail, action);
      row.append(follow);
      if (entry.visitId || entry.fallbackVisitId) {
        const visit = document.createElement('button');
        visit.className = 'wildlife-travel';
        visit.type = 'button';
        visit.textContent = entry.visitId ? '前往观察点' : '馆藏观察点';
        visit.setAttribute('aria-label', '前往' + entry.title + (entry.visitId ? '观察点' : '馆藏观察点'));
        visit.onclick = () => {
          if (this.travel(entry)) this.modal.close();
        };
        row.append(visit);
      }
      rows.append(row);
    }
    this.list.replaceChildren(rows);
    this.list.scrollTop = 0;
  }
}
