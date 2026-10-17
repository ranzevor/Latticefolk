import type { I18n } from '../i18n.js';

/** Keep constructor failures visible even before TownGame can bind its UI. */
export function startTown(createGame:()=>unknown,root:HTMLElement,i18n:Pick<I18n,'t'>):boolean {
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
    return false;
  }
}
