import type { I18n } from '../i18n.js';
import { refreshLocaleText } from './runtimeLocale.js';

/** Keep constructor failures visible even before TownGame can bind its UI. */
export function startTown(createGame:()=>unknown,root:HTMLElement,i18n:Pick<I18n,'t'|'locale'|'setLocale'>):boolean {
  try {
    createGame();
    return true;
  } catch(error) {
    console.error('Latticefolk startup failed:',error);
    const reason=error instanceof Error&&/webgl/i.test(error.message)
      ?'start.graphicsUnavailable':'start.failed';
    const overlay=root.querySelector<HTMLElement>('#startOverlay');
    overlay?.classList.remove('hidden');
    const message=overlay?.querySelector<HTMLElement>('.start-card p');
    if(message){message.dataset.i18n=reason;message.textContent=i18n.t(reason);message.setAttribute('role','alert');}
    const button=root.querySelector<HTMLButtonElement>('#startBtn');
    if(button){button.disabled=true;button.dataset.i18n='start.unavailable';button.textContent=i18n.t('start.unavailable');}
    const hint=overlay?.querySelector<HTMLElement>('[data-i18n="start.controls"]');
    if(hint){hint.dataset.i18n='start.retry';hint.textContent=i18n.t('start.retry');}
    const originalLocale=root.querySelector<HTMLSelectElement>('#localeSelect');
    const card=overlay?.querySelector<HTMLElement>('.start-card');
    if(originalLocale&&card){
      // A later constructor failure may already have attached game listeners.
      const locale=originalLocale.cloneNode(true) as HTMLSelectElement;
      originalLocale.remove();
      card.append(locale);
      locale.disabled=false;
      locale.addEventListener('change',()=>{
        i18n.setLocale(locale.value);
        locale.value=i18n.locale;
        root.ownerDocument.documentElement.lang=i18n.locale;
        refreshLocaleText(root,key=>i18n.t(key));
        try{root.ownerDocument.defaultView?.localStorage.setItem('latticefolk.locale',i18n.locale);}catch{}
      });
    }
    for(const control of root.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('button,input,select,textarea')){
      if(control.id!=='localeSelect')control.disabled=true;
    }
    // Failed runtimes must not react to gameplay shortcuts behind the alert.
    root.addEventListener('keydown',event=>event.stopPropagation());
    root.addEventListener('keyup',event=>event.stopPropagation());
    if(message){message.tabIndex=-1;message.focus();}
    return false;
  }
}
