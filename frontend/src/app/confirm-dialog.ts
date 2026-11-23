import {Component, afterRenderEffect, inject, Injectable, signal, viewChild, ElementRef} from '@angular/core';

interface Confirmation {
  title:string;
  message:string;
  label:string;
}

@Injectable({providedIn:'root'})
export class ConfirmDialog {
  private readonly request=signal<Confirmation|null>(null);
  readonly current=this.request.asReadonly();
  private resolve?: (confirmed:boolean)=>void;

  ask(title:string,message:string,label:string):Promise<boolean> {
    if(this.resolve)return Promise.resolve(false);
    return new Promise(resolve=>{
      this.resolve=resolve;
      this.request.set({title,message,label});
    });
  }

  answer(confirmed:boolean){
    const resolve=this.resolve;
    this.resolve=undefined;
    this.request.set(null);
    resolve?.(confirmed);
  }
}

@Component({
  selector:'app-confirm-dialog',
  template:`
    <dialog #dialog class="confirm-dialog" aria-labelledby="confirm-title" aria-describedby="confirm-message"
      (cancel)="cancel($event)">
      @if(confirm.current();as request){
        <div class="stack">
          <h2 id="confirm-title">{{request.title}}</h2>
          <p id="confirm-message">{{request.message}}</p>
          <div class="actions">
            <button type="button" autofocus (click)="confirm.answer(false)">Otkaži</button>
            <button type="button" class="danger" (click)="confirm.answer(true)">{{request.label}}</button>
          </div>
        </div>
      }
    </dialog>
  `
})
export class ConfirmDialogComponent {
  readonly confirm=inject(ConfirmDialog);
  private readonly dialog=viewChild<ElementRef<HTMLDialogElement>>('dialog');

  constructor(){
    afterRenderEffect(()=>{
      const element=this.dialog()?.nativeElement, request=this.confirm.current();
      if(!element)return;
      if(request&&!element.open)element.showModal();
      if(!request&&element.open)element.close();
    });
  }

  cancel(event:Event){event.preventDefault();this.confirm.answer(false);}
}
