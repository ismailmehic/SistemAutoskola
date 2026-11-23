import {Component, inject, OnDestroy, signal} from '@angular/core';
import {ActivatedRoute, RouterLink} from '@angular/router';
import {PdfPreview} from './pdf-preview';
import {ConfirmDialog} from './confirm-dialog';
import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {Api, BsDate, Candidate, Finances, Instructor, message, methods, Money, Notice, Payment, statuses, today, Type, Uploaded, saveBlob, uploadForm} from './core';

@Component({
  imports:[RouterLink,ReactiveFormsModule,BsDate,Money,PdfPreview],
  template:`
    <a class="back" routerLink="/candidates">Nazad na kandidate</a>
    @if(error()){<p class="error" role="alert">{{error()}}</p>}
    @if(row();as c){
      <div class="page-head"><div><h1>{{c.data.firstName}} {{c.data.lastName}}</h1><p>{{c.schoolName}} · Kategorija {{c.data.drivingCategory}}
        @if(c.assignments[0];as person){ · {{person.firstName}} {{person.lastName}}}</p></div>
        <span class="badge" [attr.data-status]="c.data.status">{{labels[c.data.status]}}</span>
      </div>
      <div class="tabs" aria-label="Dijelovi profila">
        @for(item of tabs;track item[0]){<button [class.active]="tab()===item[0]" [attr.aria-pressed]="tab()===item[0]" (click)="select(item[0])">{{item[1]}}</button>}
      </div>
      @if(loading()){<p class="loading" role="status">Učitavanje…</p>}
      @switch(tab()){
        @case('podaci'){
          <section class="panel inset stack">
            <div class="section-head"><h2>Podaci o kandidatu</h2><div class="actions">
              <a class="button" [routerLink]="['/candidates',id,'uredi']">Uredi podatke</a>
              <a class="button" routerLink="/maticna-knjiga" [queryParams]="{kandidat:id,skola:c.data.drivingSchoolId}">Upiši u matičnu knjigu</a>
              @if(c.data.status!=='INACTIVE'){<button [disabled]="busy()" (click)="deactivate()">Deaktiviraj</button>}
            </div></div>
            <dl class="detail-grid">
              <div><dt>Ime oca</dt><dd>{{c.data.fatherName||'—'}}</dd></div><div><dt>Datum rođenja</dt><dd>{{c.data.dateOfBirth|bsDate}}</dd></div>
              <div><dt>Općina rođenja</dt><dd>{{c.data.municipalityOfBirth}}</dd></div><div><dt>JMBG</dt><dd>{{c.data.jmbg||'—'}}</dd></div>
              <div><dt>Adresa</dt><dd>{{c.data.address||'—'}}</dd></div><div><dt>Telefon</dt><dd>{{c.data.phone||'—'}}</dd></div>
              <div><dt>E-mail</dt><dd>{{c.data.email||'—'}}</dd></div><div><dt>Datum upisa</dt><dd>{{c.data.enrollmentDate|bsDate}}</dd></div>
              <div class="wide"><dt>Napomena</dt><dd>{{c.data.notes||'—'}}</dd></div>
            </dl>
          </section>
        }
        @case('dokumenti'){
          <section class="panel inset stack">
            <div class="section-head"><h2>Dokumenti</h2><div class="actions">
              <button class="primary" (click)="openDocument()" [disabled]="busy()||loading()">Dodaj dokumente</button>
              <button (click)="zip()" [disabled]="busy()||!documents().length">Preuzmi kompletnu dokumentaciju</button>
            </div></div>
            @if(showDocumentForm()){
              <form class="editor stack" [formGroup]="documentForm" (ngSubmit)="upload()">
                <h3>{{replaceId()?'Zamijeni dokument':'Učitaj dokumente'}}</h3>
                <div class="form-grid">
                  <label>Vrsta<select formControlName="type"><option [ngValue]="0" disabled>Odaberite vrstu</option>@for(type of activeTypes();track type.id){<option [ngValue]="type.id">{{type.name}}</option>}</select></label>
                  <label>Datoteke<input #docFile type="file" [multiple]="!replaceId()" accept=".pdf,.jpg,.jpeg,.png" (change)="pick(docFile.files)"></label>
                  <label class="camera-input">Snimite dokument<input #docCamera type="file" accept="image/jpeg,image/png" capture="environment" (change)="pick(docCamera.files)"></label>
                  <label>Datum dokumenta<input type="date" formControlName="documentDate"></label>
                  <label>Datum isteka<input type="date" formControlName="expirationDate"></label>
                  <label class="wide">Napomena<textarea formControlName="notes" maxlength="500" rows="2"></textarea></label>
                </div>
                <div class="actions"><button class="primary" [disabled]="busy()||!files().length||!documentForm.value.type">Spremi</button>
                  <button type="button" [disabled]="busy()" (click)="showDocumentForm.set(false)">Otkaži</button></div>
              </form>
            }
            @if(preview();as item){
              <div class="editor stack"><div class="section-head"><h3>{{item.title}}</h3><button (click)="closePreview()">Zatvori pregled</button></div>
                @if(item.image){<img class="document-preview" [src]="item.url" [alt]="item.title">}
                @else{<app-pdf-preview [source]="item.blob" />}
              </div>
            }
            @for(doc of documents();track doc.id){
              <article class="item-row"><div><strong>{{doc.originalFileName}}</strong><p>{{typeName(doc.documentTypeId)}} · {{doc.uploadedAt|bsDate}}
                @if(doc.expirationDate){ · Ističe {{doc.expirationDate|bsDate}}}</p>@if(doc.notes){<p>{{doc.notes}}</p>}</div>
                <div class="actions"><button [disabled]="busy()" (click)="view(doc)">Prikaži</button><button [disabled]="busy()" (click)="download(doc)">Preuzmi</button>
                <button [disabled]="busy()" (click)="openDocument(doc)">Zamijeni</button><button [disabled]="busy()" class="danger-text" (click)="remove(doc)">Ukloni</button></div></article>
            }@empty{@if(!loading()){<p class="empty">Kandidat još nema dokumenata.</p>}}
          </section>
        }
        @case('uplate'){
          @if(finances();as f){
            <div class="stat-grid small">
              <article class="stat"><p>Ukupna cijena obuke</p><strong>{{f.agreedPrice|money:f.currencyCode}}</strong></article>
              <article class="stat"><p>Uplaćeno</p><strong>{{f.paid|money:f.currencyCode}}</strong></article>
              <article class="stat"><p>Preostalo</p><strong>{{f.remaining|money:f.currencyCode}}</strong></article>
            </div>
            <section class="panel inset stack">
              <div class="section-head"><h2>Historija uplata</h2><button class="primary" (click)="openPayment()">Dodaj uplatu</button></div>
              @if(showPaymentForm()){
                <form class="editor stack" [formGroup]="paymentForm" (ngSubmit)="savePayment()">
                  <h3>{{paymentId()?'Uredi uplatu':'Nova uplata'}}</h3>
                  <div class="form-grid">
                    <label>Iznos ({{f.currencyCode}})<input formControlName="amount" type="number" min="0.01" step="0.01"></label>
                    <label>Datum<input formControlName="paymentDate" type="date"></label>
                    <label>Način uplate<select formControlName="paymentMethod">@for(method of paymentMethods;track method){<option [value]="method">{{method}}</option>}</select></label>
                    <label>Napomena<input formControlName="note" maxlength="500"></label>
                  </div>
                  <div class="actions"><button class="primary" [disabled]="busy()||paymentForm.invalid">Spremi uplatu</button>
                    <button type="button" [disabled]="busy()" (click)="showPaymentForm.set(false)">Otkaži</button></div>
                </form>
              }
              @if(voidId()){
                <form class="editor stack" [formGroup]="reasonForm" (ngSubmit)="voidPayment()">
                  <h3>Storniranje uplate</h3><label>Razlog<textarea rows="2" maxlength="500" formControlName="reason"></textarea></label>
                  <div class="actions"><button class="danger" [disabled]="busy()||reasonForm.invalid">Potvrdi storniranje</button>
                    <button type="button" [disabled]="busy()" (click)="voidId.set(null)">Otkaži</button></div>
                </form>
              }
              @if(f.items.length){
                <table class="data-table responsive"><thead><tr><th>Datum</th><th>Iznos</th><th>Način</th><th>Napomena</th><th>Radnje</th></tr></thead><tbody>
                  @for(item of f.items;track item.id){<tr><td data-label="Datum">{{item.data.paymentDate|bsDate}}</td><td data-label="Iznos">{{item.data.amount|money:f.currencyCode}}</td>
                    <td data-label="Način">{{item.data.paymentMethod}}</td><td data-label="Napomena">{{item.data.note||'—'}}</td><td data-label="Radnje">
                      @if(item.voidedAt){<span class="badge">Stornirano</span>}
                      @else{<div class="actions"><button [disabled]="busy()" (click)="openPayment(item)">Uredi</button><button [disabled]="busy()" class="danger-text" (click)="askVoid(item.id)">Storniraj</button></div>}
                    </td></tr>}
                </tbody></table>
              }@else{<p class="empty">Još nema evidentiranih uplata.</p>}
            </section>
          }
        }
        @case('obuka'){
          <section class="panel inset stack">
            <div class="section-head"><h2>Obuka</h2><a class="button" [routerLink]="['/candidates',id,'uredi']">Uredi podatke o obuci</a></div>
            <dl class="detail-grid">
              <div><dt>Datum upisa</dt><dd>{{c.data.enrollmentDate|bsDate}}</dd></div><div><dt>Kategorija</dt><dd>{{c.data.drivingCategory}}</dd></div>
              <div><dt>Status</dt><dd>{{labels[c.data.status]}}</dd></div><div><dt>Datum završetka</dt><dd>{{c.data.completionDate|bsDate}}</dd></div>
              @for(item of c.assignments;track item.instructorId){<div><dt>{{item.isPrimary?'Glavni instruktor':'Dodatni instruktor'}}</dt><dd>{{item.firstName}} {{item.lastName}} · {{item.allocationPercentage}}%</dd></div>}
              <div class="wide"><dt>Napomena</dt><dd>{{c.data.notes||'—'}}</dd></div>
            </dl>
            <form class="editor stack" [formGroup]="assignForm" (ngSubmit)="assign()">
              <h3>Zaduženje instruktora</h3>
              <div class="form-grid">
                <label>Glavni instruktor<select formControlName="primary"><option [ngValue]="0">Bez instruktora</option>
                  @for(item of instructors();track item.id){<option [ngValue]="item.id">{{item.data.firstName}} {{item.data.lastName}}{{item.data.isActive?'':' (neaktivan)'}}</option>}</select></label>
                <label>Dodatni instruktor<select formControlName="secondary"><option [ngValue]="0">Bez dodatnog instruktora</option>
                  @for(item of instructors();track item.id){<option [ngValue]="item.id">{{item.data.firstName}} {{item.data.lastName}}{{item.data.isActive?'':' (neaktivan)'}}</option>}</select></label>
                @if(assignForm.value.secondary){<label>Udio glavnog instruktora (%)<input type="number" min="0.01" max="99.99" step="0.01" formControlName="share"></label>}
              </div>
              <div class="actions"><button class="primary" [disabled]="busy()||loading()">Spremi zaduženje</button></div>
            </form>
          </section>
        }
      }
    }@else if(!error()){<p class="loading" role="status">Učitavanje profila…</p>}
  `
})
export class Profile implements OnDestroy {
  private api=inject(Api);private confirmation=inject(ConfirmDialog);private fb=inject(FormBuilder);private route=inject(ActivatedRoute);private notice=inject(Notice);
  readonly id=Number(this.route.snapshot.paramMap.get('id'));
  readonly tabs=[['podaci','Podaci'],['dokumenti','Dokumenti'],['uplate','Uplate'],['obuka','Obuka']];
  readonly tab=signal('podaci');readonly row=signal<Candidate|null>(null);readonly labels=statuses;readonly paymentMethods=methods;
  readonly error=signal('');readonly busy=signal(false);readonly loading=signal(false);
  readonly documents=signal<Uploaded[]>([]);readonly types=signal<Type[]>([]);readonly files=signal<File[]>([]);
  readonly showDocumentForm=signal(false);readonly replaceId=signal<string|null>(null);
  readonly preview=signal<{url:string;blob:Blob;title:string;image:boolean}|null>(null);
  readonly documentForm=this.fb.nonNullable.group({type:0,documentDate:'',expirationDate:'',notes:''});
  readonly finances=signal<Finances|null>(null);readonly showPaymentForm=signal(false);readonly paymentId=signal<number|null>(null);
  readonly voidId=signal<number|null>(null);readonly reasonForm=this.fb.nonNullable.group({reason:['',Validators.required]});
  readonly paymentForm=this.fb.nonNullable.group({amount:[0,[Validators.required,Validators.min(.01)]],
    paymentDate:[today(),Validators.required],paymentMethod:methods[0],note:''});
  readonly instructors=signal<Instructor[]>([]);
  readonly assignForm=this.fb.nonNullable.group({primary:0,secondary:0,share:50});
  private request=0;
  constructor(){void this.init();}
  ngOnDestroy(){this.closePreview();}
  private async init(){
    try{
      await this.fetch();
      const tab=this.route.snapshot.queryParamMap.get('tab');
      if(tab&&this.tabs.some(item=>item[0]===tab))await this.select(tab);
      if(tab==='uplate'&&this.route.snapshot.queryParamMap.get('akcija')==='nova')this.openPayment();
    }catch(error){this.error.set(message(error));}
  }
  private async fetch(){this.row.set(await this.api.get<Candidate>('/candidates/'+this.id));}
  async select(tab:string){
    if(this.busy())return;
    const request=++this.request;
    this.closePreview();this.tab.set(tab);this.error.set('');this.loading.set(tab!=='podaci');
    try{
      if(tab==='uplate')await this.loadPayments();
      if(tab==='dokumenti')await this.loadDocuments();
      if(tab==='obuka'){
        const c=this.row()!;
        const rows=await this.api.get<Instructor[]>('/instructors',{schoolId:c.data.drivingSchoolId});
        this.instructors.set(rows.filter(x=>x.data.isActive||c.assignments.some(a=>a.instructorId===x.id)));
        this.assignForm.setValue({primary:c.assignments[0]?.instructorId??0,secondary:c.assignments[1]?.instructorId??0,
          share:c.assignments.length===2?c.assignments[0].allocationPercentage:50});
      }
    }catch(error){if(request===this.request)this.error.set(message(error));}
    finally{if(request===this.request)this.loading.set(false);}
  }
  private async run(action:()=>Promise<void>){
    if(this.busy())return;
    this.busy.set(true);this.error.set('');
    try{await action();}catch(error){this.error.set(message(error));}finally{this.busy.set(false);}
  }
  async deactivate(){
    if(this.busy()||!await this.confirmation.ask('Deaktivirati kandidata?',
      'Dokumenti, uplate i matični upisi ostaju u evidenciji.','Deaktiviraj kandidata'))return;
    return this.run(async()=>{await this.api.patch('/candidates/'+this.id+'/status',{status:'INACTIVE',completionDate:null});await this.fetch();this.notice.show('Kandidat je deaktiviran.');});
  }
  activeTypes(){return this.types().filter(x=>x.isActive);}
  typeName(id:number){return this.types().find(x=>x.id===id)?.name??'Dokument';}
  private async loadDocuments(){
    const [documents,types]=await Promise.all([this.api.get<Uploaded[]>('/candidates/'+this.id+'/documents'),this.api.get<Type[]>('/document-types')]);
    this.documents.set(documents);this.types.set(types);
  }
  openDocument(doc?:Uploaded){
    this.replaceId.set(doc?.id??null);this.files.set([]);
    this.documentForm.setValue({type:this.activeTypes().some(t=>t.id===doc?.documentTypeId)?doc!.documentTypeId:this.activeTypes()[0]?.id??0,
      documentDate:doc?.documentDate??'',expirationDate:doc?.expirationDate??'',notes:doc?.notes??''});
    this.showDocumentForm.set(true);
  }
  pick(files:FileList|null){this.files.set(Array.from(files??[]));}
  upload(){return this.run(async()=>{
    const {type,...meta}=this.documentForm.getRawValue();
    const form=uploadForm(this.files(),type,meta);
    if(this.replaceId())await this.api.put('/documents/'+this.replaceId(),form);
    else await this.api.post('/candidates/'+this.id+'/documents',form);
    this.showDocumentForm.set(false);this.closePreview();await this.loadDocuments();this.notice.show('Dokumenti su spremljeni.');
  });}
  view(doc:Uploaded){return this.run(async()=>{
    const blob=await this.api.blob('/documents/'+doc.id+'/preview');
    this.closePreview();
    const image=doc.contentType.startsWith('image/');
    this.preview.set({url:image?URL.createObjectURL(blob):'',blob,title:doc.originalFileName,image});
  });}
  closePreview(){const old=this.preview();if(old?.url)URL.revokeObjectURL(old.url);this.preview.set(null);}
  download(doc:Uploaded){return this.run(async()=>saveBlob(await this.api.blob('/documents/'+doc.id+'/download'),doc.originalFileName));}
  zip(){return this.run(async()=>saveBlob(await this.api.blob('/candidates/'+this.id+'/documents/zip'),'dokumenti-'+this.id+'.zip'));}
  async remove(doc:Uploaded){
    if(this.busy()||!await this.confirmation.ask('Ukloniti dokument?',
      'Dokument „'+doc.originalFileName+'“ bit će uklonjen iz profila kandidata.','Ukloni dokument'))return;
    return this.run(async()=>{await this.api.delete('/documents/'+doc.id);this.closePreview();await this.loadDocuments();this.notice.show('Dokument je uklonjen.');});
  }
  private async loadPayments(){this.finances.set(await this.api.get<Finances>('/candidates/'+this.id+'/payments'));}
  openPayment(payment?:Payment){
    this.voidId.set(null);this.paymentId.set(payment?.id??null);
    this.paymentForm.setValue(payment?.data??{amount:0,paymentDate:today(),paymentMethod:methods[0],note:''});
    this.showPaymentForm.set(true);
  }
  savePayment(){return this.run(async()=>{
    if(this.paymentForm.invalid)return;
    const data=this.paymentForm.getRawValue();
    if(this.paymentId())await this.api.put('/payments/'+this.paymentId(),data);
    else await this.api.post('/candidates/'+this.id+'/payments',data);
    this.showPaymentForm.set(false);await this.loadPayments();this.notice.show('Uplata je spremljena.');
  });}
  askVoid(id:number){this.showPaymentForm.set(false);this.reasonForm.reset();this.voidId.set(id);}
  voidPayment(){return this.run(async()=>{
    if(this.reasonForm.invalid||!this.voidId())return;
    await this.api.post('/payments/'+this.voidId()+'/void',this.reasonForm.getRawValue());this.voidId.set(null);
    await this.loadPayments();this.notice.show('Uplata je stornirana.');
  });}
  assign(){return this.run(async()=>{
    const {primary,secondary,share}=this.assignForm.getRawValue();
    if(secondary&&!primary)throw new Error('Odaberite glavnog instruktora.');
    const input=primary?[{instructorId:primary,allocationPercentage:secondary?share:100}]:[];
    if(secondary)input.push({instructorId:secondary,allocationPercentage:Math.round((100-share)*100)/100});
    await this.api.put('/candidates/'+this.id+'/assignments',input);await this.fetch();this.notice.show('Zaduženje je spremljeno.');
  });}
}
