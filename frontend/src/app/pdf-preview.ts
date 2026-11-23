import {AfterViewInit, Component, ElementRef, input, OnDestroy, signal, viewChild} from '@angular/core';
import type {PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask} from 'pdfjs-dist';

@Component({
  selector:'app-pdf-preview',
  template:`
    <div class="stack">
      @if(error()){<p class="error" role="alert">{{error()}}</p>}
      @if(busy()){<p class="loading" role="status">Učitavanje PDF pregleda…</p>}
      @if(total()>1){
        <div class="actions">
          <button (click)="render(page()-1)" [disabled]="busy()||page()===1">Prethodna</button>
          <span>Strana {{page()}} od {{total()}}</span>
          <button (click)="render(page()+1)" [disabled]="busy()||page()===total()">Sljedeća</button>
        </div>
      }
      <canvas #pageCanvas class="document-preview" [hidden]="!total()||!!error()" [attr.aria-label]="'PDF, strana '+page()"></canvas>
    </div>`
})
export class PdfPreview implements AfterViewInit, OnDestroy {
  readonly source=input.required<Blob>();
  private readonly canvas=viewChild.required<ElementRef<HTMLCanvasElement>>('pageCanvas');
  private task?:PDFDocumentLoadingTask;
  private pdf?:PDFDocumentProxy;
  private drawing?:RenderTask;
  private destroyed=false;
  readonly page=signal(1);readonly total=signal(0);readonly error=signal('');readonly busy=signal(true);

  ngAfterViewInit(){void this.load();}
  ngOnDestroy(){
    this.destroyed=true;
    this.drawing?.cancel();
    void this.task?.destroy().catch(()=>{});
  }
  private async load(){
    try{
      const [pdfjs,data]=await Promise.all([import('pdfjs-dist'),this.source().arrayBuffer()]);
      if(this.destroyed)return;
      const assets=new URL('pdfjs/',document.baseURI).href;
      pdfjs.GlobalWorkerOptions.workerSrc=assets+'pdf.worker.min.mjs';
      this.task=pdfjs.getDocument({data,cMapUrl:assets+'cmaps/',standardFontDataUrl:assets+'standard_fonts/',
        useWasm:false,enableXfa:false,maxImageSize:24_000_000,canvasMaxAreaInBytes:96_000_000,verbosity:0});
      this.pdf=await this.task.promise;
      if(this.destroyed)return;
      this.total.set(this.pdf.numPages);
      await this.render(1);
    }catch{
      if(!this.destroyed)this.error.set('PDF nije moguće prikazati. Dokument možete preuzeti.');
    }finally{if(!this.destroyed)this.busy.set(false);}
  }
  async render(number:number){
    const pdf=this.pdf;
    if(!pdf||number<1||number>pdf.numPages||this.drawing)return;
    this.busy.set(true);this.error.set('');
    try{
      const page=await pdf.getPage(number);
      if(this.destroyed)return;
      const canvas=this.canvas().nativeElement;
      const natural=page.getViewport({scale:1});
      const width=Math.min(1300,(canvas.parentElement?.clientWidth||600)*Math.min(2,window.devicePixelRatio));
      const scale=Math.min(width/natural.width,1800/natural.height);
      const viewport=page.getViewport({scale});
      canvas.width=Math.ceil(viewport.width);
      canvas.height=Math.ceil(viewport.height);
      this.drawing=page.render({canvas,viewport,annotationMode:0});
      await this.drawing.promise;
      if(!this.destroyed)this.page.set(number);
    }catch{
      if(!this.destroyed)this.error.set('Stranu PDF-a nije moguće prikazati.');
    }finally{this.drawing=undefined;if(!this.destroyed)this.busy.set(false);}
  }
}
