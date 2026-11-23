import {Component, computed, effect, inject, signal, untracked} from '@angular/core';
import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {ActivatedRoute, RouterLink} from '@angular/router';
import {Archive, BookOpen, Download, LucideAngularModule, Plus, Printer} from 'lucide-angular';
import {Api, BsDate, CandidateRow, message, Notice, Paged, RegisterSuggestions, Schools, Settings, saveBlob, today} from './core';

import {ConfirmDialog} from './confirm-dialog';
interface Book {id:number; drivingSchoolId:number; schoolName:string; year:number; capacity:number; lastSerial:number; pageCount:number; nextSerial:number; archivedAt:string|null}
interface Fields {
  medicalCertificateNumber:string|null; medicalCertificateDate:string|null; medicalInstitution:string|null;
  theoryCertificateNumber:string|null; theoryCertificateDate:string|null; firstAidCertificateNumber:string|null;
  firstAidCertificateDate:string|null; drivingCertificateNumber:string|null; drivingCertificateDate:string|null; note:string|null;
}
interface Entry {
  id:number; candidateId:number; pageNumber:number; rowNumber:number; serialNumber:number;
  identity:{firstName:string;lastName:string;fatherName:string;dateOfBirth:string;municipalityOfBirth:string};
  fields:Fields; voidedAt:string|null; voidReason:string|null;
}
interface Row {rowNumber:number;entry:Entry|null}
interface Page {book:Book;pageNumber:number;rows:Row[]}
const blank:Fields={medicalCertificateNumber:null,medicalCertificateDate:null,medicalInstitution:null,theoryCertificateNumber:null,
  theoryCertificateDate:null,firstAidCertificateNumber:null,firstAidCertificateDate:null,drivingCertificateNumber:null,drivingCertificateDate:null,note:null};

@Component({
  imports:[ReactiveFormsModule,RouterLink,LucideAngularModule,BsDate],
  template:`
    <div class="page-head"><div><h1>E-Matična knjiga</h1><p>Pregled i vođenje matičnih knjiga po autoškoli i godini.</p></div>
      <button class="primary" (click)="openBookForm()" [disabled]="busy()"><lucide-icon [img]="plus" size="17"/>Nova knjiga</button></div>
    @if(error()){<p class="error" role="alert">{{error()}}</p>}
    @if(showBookForm()){
      <form class="panel inset stack" [formGroup]="bookForm" (ngSubmit)="create()">
        <h2>Nova matična knjiga</h2>
        <div class="form-grid three">
          <label>Autoškola<select formControlName="drivingSchoolId"><option [ngValue]="0" disabled>Odaberite autoškolu</option>
            @for(school of schools.items();track school.id){@if(school.data.isActive){<option [ngValue]="school.id">{{school.data.name}}</option>}}</select></label>
          <label>Godina<input formControlName="year" type="number" min="1900" max="9999"></label>
          <label>Redova po strani<input formControlName="capacity" type="number" min="1" max="20"></label>
        </div>
        @if(!hasActiveSchools()){<a routerLink="/postavke">Dodaj autoškolu u postavkama</a>}
        <div class="actions"><button class="primary" [disabled]="bookForm.invalid||busy()">Kreiraj knjigu</button><button type="button" (click)="showBookForm.set(false)" [disabled]="busy()">Otkaži</button></div>
      </form>
    }
    @if(loading()){<p class="loading" role="status">Učitavanje matične knjige…</p>}
    @if(books().length){
      <section class="panel inset stack register-controls">
        <div class="actions"><label>Matična knjiga<select [value]="bookId()??''" (change)="chooseBook(+$any($event.target).value)">
          @for(item of books();track item.id){<option [value]="item.id" [selected]="item.id===bookId()">{{item.year}} · {{item.schoolName}}{{item.archivedAt?' · arhiva':''}}</option>}
        </select></label>
        @if(page();as p){
          <label>Strana<select [value]="p.pageNumber" (change)="loadPage(p.book.id,+$any($event.target).value)">
            @for(n of pageNumbers();track n){<option [value]="n" [selected]="n===p.pageNumber">{{n}}</option>}
          </select></label>
          <div class="actions"><button [disabled]="p.pageNumber===1||busy()" (click)="loadPage(p.book.id,p.pageNumber-1)">Prethodna</button>
            <button [disabled]="p.pageNumber===p.book.pageCount||busy()" (click)="loadPage(p.book.id,p.pageNumber+1)">Sljedeća</button></div>
        }</div>
        @if(page();as p){
          <div class="actions">
            @if(!p.book.archivedAt){
              <button class="primary" [disabled]="busy()" (click)="openEntry()"><lucide-icon [img]="plus" size="17"/>Dodaj kandidata u matičnu knjigu</button>
              @if(!p.book.lastSerial){<button [disabled]="busy()" (click)="openCapacity()">Uredi kapacitet</button>}
              <button [disabled]="busy()" (click)="archive()"><lucide-icon [img]="archiveIcon" size="17"/>Arhiviraj</button>
            }
            <button [disabled]="busy()" (click)="print()"><lucide-icon [img]="printer" size="17"/>Štampaj stranu</button>
            <button [disabled]="busy()" (click)="exportPdf(true)"><lucide-icon [img]="download" size="17"/>PDF strane</button>
            <button [disabled]="busy()" (click)="exportPdf(false)">PDF cijele knjige</button>
          </div>
        }
      </section>
    }@else if(!loading()&&!error()){
      <section class="panel empty"><lucide-icon [img]="bookIcon" size="28"/><h2>Još nema matičnih knjiga</h2><p>Kreirajte knjigu za željenu godinu i autoškolu.</p></section>
    }
    @if(page();as p){
      @if(showCapacity()){
        <form class="panel inset stack" [formGroup]="capacityForm" (ngSubmit)="capacity()">
          <h2>Kapacitet stranice</h2><label>Redova po strani<input type="number" min="1" max="20" formControlName="capacity"></label>
          <div class="actions"><button class="primary" [disabled]="busy()||capacityForm.invalid">Spremi kapacitet</button><button type="button" (click)="showCapacity.set(false)">Otkaži</button></div>
        </form>
      }
      @if(entryOpen()){
        <form class="panel inset stack" [formGroup]="entryForm" (ngSubmit)="saveEntry()">
          <h2>{{editId()?'Uredi matični upis':'Dodaj kandidata u matičnu knjigu'}}</h2>
          @if(!editId()){
            <p class="muted">Predloženi redni broj {{p.book.nextSerial}} · Strana {{position()[0]}} · Red {{position()[1]}}</p>
            <div class="form-grid">
              <label>Pretraga kandidata<input type="search" [formControl]="search" placeholder="Ime ili prezime" (keydown.enter)="$event.preventDefault();findCandidates()"></label>
              <label>Kandidat<select formControlName="candidateId"><option [ngValue]="0" disabled>Odaberite kandidata</option>
                @for(row of candidates();track row.id){<option [ngValue]="row.id">{{row.lastName}} {{row.firstName}}</option>}</select></label>
            </div>
            <div class="actions">
              <button type="button" [disabled]="candidateLoading()" (click)="findCandidates()">{{candidateLoading()?'Pretraga…':'Pretraži'}}</button>
              @if(candidateTotal()>50){<button type="button" [disabled]="candidatePage()===1||candidateLoading()" (click)="findCandidates(candidatePage()-1)">Prethodnih 50</button>
                <button type="button" [disabled]="candidatePage()*50>=candidateTotal()||candidateLoading()" (click)="findCandidates(candidatePage()+1)">Sljedećih 50</button>}
              <a class="button" routerLink="/candidates/novi" [queryParams]="{knjiga:p.book.id,skola:p.book.drivingSchoolId}">Kreiraj novog kandidata</a>
            </div>
            @if(!candidateLoading()&&!candidates().length){<p class="muted">Nema kandidata za ovu pretragu.</p>}
          }@else{<label class="checkbox"><input type="checkbox" formControlName="refreshCandidateIdentity"> Osvježi lične podatke iz profila kandidata</label>}
          <div class="form-grid">
            @for(field of fields;track field.key){
              @if(field.key==='note'){<label class="wide">{{field.label}}<textarea formControlName="note" maxlength="250" rows="2"></textarea></label>}
              @else{<label>{{field.label}}<input [type]="field.type" [formControlName]="field.key" [attr.maxlength]="field.key==='medicalInstitution'?100:45"></label>}
            }
          </div>
          <div class="actions"><button class="primary" [disabled]="busy()||(!editId()&&!entryForm.value.candidateId)">{{editId()?'Spremi izmjene':'Potvrdi upis'}}</button>
            <button type="button" (click)="entryOpen.set(false)" [disabled]="busy()">Otkaži</button></div>
        </form>
      }
      @if(voidId()){
        <form class="panel inset stack" [formGroup]="voidForm" (ngSubmit)="voidEntry()">
          <h2>Poništi matični upis</h2><p class="muted">Red i broj ostaju u knjizi. Poništavanje će biti zabilježeno.</p>
          <label>Razlog<textarea formControlName="reason" rows="2" maxlength="250"></textarea></label>
          <div class="actions"><button class="danger" [disabled]="busy()||voidForm.invalid">Potvrdi poništavanje</button><button type="button" [disabled]="busy()" (click)="voidId.set(null)">Otkaži</button></div>
        </form>
      }
      <section class="paper panel">
        <header class="paper-head"><div><h2>MATIČNA KNJIGA za {{p.book.year}}. godinu</h2><p>{{p.book.schoolName}}</p></div>
          <div class="paper-meta"><span>Strana <strong>{{p.pageNumber}}</strong></span>@if(p.book.archivedAt){<span class="badge">Arhivirana {{p.book.archivedAt|bsDate}}</span>}</div>
        </header>
        <button class="mobile-view" (click)="showTable.update(v=>!v)">{{showTable()?'Prikaži kartice':'Prikaži tabelu'}}</button>
        <div class="register-scroll" [class.mobile-visible]="showTable()">
          <table class="register-table">
            <colgroup><col class="serial"><col class="identity"><col class="birth"><col class="medical"><col class="certificate"><col class="certificate"><col class="certificate"><col class="note"></colgroup>
            <thead><tr><th rowspan="2" scope="col">Redni broj</th><th rowspan="2" scope="col">Prezime i ime<br>(ime oca)</th>
              <th rowspan="2" scope="col">Datum rođenja<br>Općina rođenja</th><th scope="col">Ljekarsko uvjerenje</th>
              <th colspan="3" scope="colgroup">Broj i datum potvrda o završenoj obuci</th><th rowspan="2" scope="col">Napomena</th></tr>
              <tr><th scope="col">Broj · datum<br>Naziv zdravstvene ustanove</th><th scope="col">Teoretska nastava</th>
                <th scope="col">Pružanje prve pomoći</th><th scope="col">Upravljanje motornim vozilom</th></tr></thead>
            <tbody>
              @for(row of p.rows;track row.rowNumber){<tr [class.voided]="!!row.entry?.voidedAt">
                @if(row.entry;as e){
                  <td class="serial-cell">{{e.serialNumber}}</td>
                  <td><a [routerLink]="['/candidates',e.candidateId]">{{e.identity.lastName}} {{e.identity.firstName}}</a>
                    @if(e.identity.fatherName){<small>({{e.identity.fatherName}})</small>}</td>
                  <td>{{e.identity.dateOfBirth|bsDate}}<small>{{e.identity.municipalityOfBirth}}</small></td>
                  <td>{{e.fields.medicalCertificateNumber}} @if(e.fields.medicalCertificateDate){<small>{{e.fields.medicalCertificateDate|bsDate}}</small>}<small>{{e.fields.medicalInstitution}}</small></td>
                  <td>{{e.fields.theoryCertificateNumber}} @if(e.fields.theoryCertificateDate){<small>{{e.fields.theoryCertificateDate|bsDate}}</small>}</td>
                  <td>{{e.fields.firstAidCertificateNumber}} @if(e.fields.firstAidCertificateDate){<small>{{e.fields.firstAidCertificateDate|bsDate}}</small>}</td>
                  <td>{{e.fields.drivingCertificateNumber}} @if(e.fields.drivingCertificateDate){<small>{{e.fields.drivingCertificateDate|bsDate}}</small>}</td>
                  <td>{{e.fields.note}}
                    @if(e.voidedAt){<small>Poništeno · {{e.voidReason}}</small>}
                    @else if(!p.book.archivedAt){<div class="row-actions"><button class="text-button" (click)="edit(e)">Uredi</button><button class="text-button danger-text" (click)="askVoid(e)">Poništi</button></div>}
                  </td>
                }@else{<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>}
              </tr>}
            </tbody>
          </table>
        </div>
        <div class="register-cards" [class.mobile-hidden]="showTable()">
          @for(row of p.rows;track row.rowNumber){
            <article class="item-row">
              @if(row.entry;as e){
                <div><strong>{{e.serialNumber}}.</strong> <a [routerLink]="['/candidates',e.candidateId]">{{e.identity.lastName}} {{e.identity.firstName}}</a>
                  <p>{{e.identity.dateOfBirth|bsDate}} · {{e.identity.municipalityOfBirth}}</p>
                  @if(e.voidedAt){<p>Poništeno · {{e.voidReason}}</p>}
                  <details><summary>Podaci upisa</summary>
                    @for(field of fields;track field.key){
                      @if(e.fields[field.key]){<div>{{field.label}} · {{field.type==='date'?(e.fields[field.key]|bsDate):e.fields[field.key]}}</div>}
                    }
                  </details>
                </div>
                @if(!p.book.archivedAt&&!e.voidedAt){<div class="actions"><button (click)="edit(e)">Uredi</button><button class="danger-text" (click)="askVoid(e)">Poništi</button></div>}
              }@else{<p>Prazan red {{row.rowNumber}}</p>}
            </article>
          }
        </div>
      </section>
    }
  `
})
export class Register {
  private api=inject(Api);private confirmation=inject(ConfirmDialog);private fb=inject(FormBuilder);private notice=inject(Notice);private route=inject(ActivatedRoute);private suggestions=inject(RegisterSuggestions);
  readonly schools=inject(Schools);readonly hasActiveSchools=computed(()=>this.schools.items().some(x=>x.data.isActive));
  readonly books=signal<Book[]>([]);readonly page=signal<Page|null>(null);readonly bookId=signal<number|null>(null);
  readonly pageNumbers=computed(()=>Array.from({length:this.page()?.book.pageCount??0},(_,i)=>i+1));
  readonly position=computed(()=>{const book=this.page()?.book;if(!book)return [0,0];return [Math.floor(book.lastSerial/book.capacity)+1,book.lastSerial%book.capacity+1];});
  readonly error=signal('');readonly loading=signal(false);readonly busy=signal(false);readonly showTable=signal(false);
  readonly showBookForm=signal(false);readonly showCapacity=signal(false);readonly entryOpen=signal(false);
  readonly editId=signal<number|null>(null);readonly voidId=signal<number|null>(null);
  readonly candidates=signal<CandidateRow[]>([]);readonly candidateLoading=signal(false);readonly candidatePage=signal(1);readonly candidateTotal=signal(0);
  readonly bookForm=this.fb.nonNullable.group({drivingSchoolId:[0,Validators.min(1)],year:[Number(today().slice(0,4)),[Validators.min(1900),Validators.max(9999)]],
    capacity:[10,[Validators.min(1),Validators.max(20)]]});
  readonly capacityForm=this.fb.nonNullable.group({capacity:[10,[Validators.required,Validators.min(1),Validators.max(20)]]});
  readonly entryForm=this.fb.group({...blank,candidateId:0,refreshCandidateIdentity:false});
  readonly search=this.fb.nonNullable.control('');
  readonly voidForm=this.fb.nonNullable.group({reason:['',Validators.required]});
  readonly fields:{key:keyof Fields;label:string;type:string}[]=[
    {key:'medicalCertificateNumber',label:'Broj ljekarskog uvjerenja',type:'text'},{key:'medicalCertificateDate',label:'Datum ljekarskog uvjerenja',type:'date'},
    {key:'medicalInstitution',label:'Naziv zdravstvene ustanove',type:'text'},
    {key:'theoryCertificateNumber',label:'Broj potvrde o teoriji',type:'text'},{key:'theoryCertificateDate',label:'Datum potvrde o teoriji',type:'date'},
    {key:'firstAidCertificateNumber',label:'Broj potvrde o prvoj pomoći',type:'text'},{key:'firstAidCertificateDate',label:'Datum potvrde o prvoj pomoći',type:'date'},
    {key:'drivingCertificateNumber',label:'Broj potvrde o praktičnoj obuci',type:'text'},{key:'drivingCertificateDate',label:'Datum potvrde o praktičnoj obuci',type:'date'},
    {key:'note',label:'Napomena',type:'text'}
  ];
  readonly plus=Plus;readonly archiveIcon=Archive;readonly printer=Printer;readonly download=Download;readonly bookIcon=BookOpen;
  private requestedBook=Number(this.route.snapshot.queryParamMap.get('knjiga'))||null;
  private requestedCandidate=Number(this.route.snapshot.queryParamMap.get('kandidat'))||null;
  private requestedSchool=Number(this.route.snapshot.queryParamMap.get('skola'))||null;
  private request=0;private candidateRequest=0;
  constructor(){
    if(this.requestedSchool)this.schools.choose(this.requestedSchool);
    effect(()=>{const selected=this.schools.selected();untracked(()=>void this.loadBooks(selected));});
  }
  private async loadBooks(schoolId:number|null,preferred?:number){
    const request=++this.request;this.loading.set(true);this.error.set('');this.page.set(null);this.closeEditors();this.books.set([]);
    try{
      const rows=await this.api.get<Book[]>('/register-books',{schoolId});
      if(request!==this.request)return;
      this.books.set(rows);
      const id=preferred??this.requestedBook;
      const selected=rows.find(x=>x.id===id)??rows.find(x=>!x.archivedAt)??rows[0];
      this.requestedBook=null;
      this.bookId.set(selected?.id??null);
      if(selected)await this.loadPage(selected.id,1);
    }catch(error){if(request===this.request)this.error.set(message(error));}
    finally{if(request===this.request)this.loading.set(false);}
  }
  async openBookForm(){
    this.closeEditors();this.error.set('');
    this.bookForm.patchValue({drivingSchoolId:this.schools.selected()??0});this.showBookForm.set(true);
    try{this.bookForm.controls.capacity.setValue((await this.api.get<Settings>('/settings')).defaultPageCapacity);}
    catch(error){this.error.set(message(error));}
  }
  create(){return this.run(async()=>{
    if(this.bookForm.invalid)return;
    const book=await this.api.post<Book>('/register-books',this.bookForm.getRawValue());
    this.showBookForm.set(false);
    await this.loadBooks(this.schools.selected(),book.id);this.notice.show('Matična knjiga je kreirana.');
  });}
  chooseBook(id:number){this.requestedCandidate=null;this.closeEditors();return this.loadPage(id,1);}
  async loadPage(id:number,n:number){
    const request=++this.request;this.loading.set(true);this.error.set('');this.bookId.set(id);this.page.set(null);this.closeEditors();
    try{
      const result=await this.api.get<Page>('/register-books/'+id+'/pages/'+n);
      if(request!==this.request)return;
      this.page.set(result);this.books.update(items=>items.map(item=>item.id===id?result.book:item));
      if(this.requestedCandidate&&!result.book.archivedAt){
        const candidate=this.requestedCandidate;this.requestedCandidate=null;
        await this.openEntry(candidate);
      }
    }catch(error){if(request===this.request)this.error.set(message(error));}
    finally{if(request===this.request)this.loading.set(false);}
  }
  private closeEditors(){
    this.candidateRequest++;
    this.candidateLoading.set(false);
    this.entryOpen.set(false);this.voidId.set(null);this.showCapacity.set(false);
  }
  openCapacity(){this.closeEditors();this.capacityForm.controls.capacity.setValue(this.page()!.book.capacity);this.showCapacity.set(true);}
  capacity(){return this.run(async()=>{
    await this.api.put('/register-books/'+this.bookId()+'/capacity',this.capacityForm.getRawValue());
    await this.loadPage(this.bookId()!,1);this.notice.show('Kapacitet je spremljen.');
  });}
  async openEntry(candidateId=0){
    this.closeEditors();this.editId.set(null);this.entryForm.reset({...blank,...this.suggestions.get(candidateId),candidateId,refreshCandidateIdentity:false});this.search.reset();
    this.candidates.set([]);this.entryOpen.set(true);
    await this.findCandidates(1,candidateId);
  }
  async findCandidates(page=1,selected=0){
    const book=this.page()?.book;if(!book)return;
    const request=++this.candidateRequest;
    this.candidateLoading.set(true);this.error.set('');
    try{
      const items=await this.api.get<Paged<CandidateRow>>('/candidates',{schoolId:book.drivingSchoolId,page,search:this.search.value,pageSize:50});
      if(selected&&!items.items.some(item=>item.id===selected)){
        const candidate=await this.api.get<{id:number;data:CandidateRow&{drivingSchoolId:number}}>('/candidates/'+selected);
        if(candidate.data.drivingSchoolId===book.drivingSchoolId)items.items.unshift({...candidate.data,id:candidate.id});
      }
      if(request===this.candidateRequest){
        this.candidates.set(items.items);this.candidatePage.set(page);this.candidateTotal.set(items.total);
        const choice=this.entryForm.controls.candidateId;
        if(choice.value&&!items.items.some(x=>x.id===choice.value))choice.setValue(0);
      }
    }catch(error){if(request===this.candidateRequest)this.error.set(message(error));}
    finally{if(request===this.candidateRequest)this.candidateLoading.set(false);}
  }
  edit(e:Entry){
    this.closeEditors();this.editId.set(e.id);this.entryForm.reset({...e.fields,candidateId:e.candidateId,refreshCandidateIdentity:false});
    this.entryOpen.set(true);window.scrollTo({top:0,behavior:'smooth'});
  }
  saveEntry(){return this.run(async()=>{
    const p=this.page();if(!p)return;
    const {candidateId,refreshCandidateIdentity,...raw}=this.entryForm.getRawValue();
    const fields=Object.fromEntries(Object.entries(raw).map(([key,value])=>[key,value||null]));
    let number=p.pageNumber;
    if(this.editId())await this.api.put('/register-entries/'+this.editId(),{fields,refreshCandidateIdentity});
    else{
      try{
        const entry=await this.api.post<Entry>('/register-books/'+p.book.id+'/entries',{fields,candidateId,expectedSerial:p.book.nextSerial});
        number=entry.pageNumber;
        this.suggestions.clear();
      }catch(error){
        const book=await this.api.get<Book>('/register-books/'+p.book.id);
        this.page.update(current=>current?.book.id===book.id?{...current,book}:current);
        throw error;
      }
    }
    await this.loadPage(p.book.id,number);this.notice.show('Matični upis je spremljen.');
  });}
  askVoid(e:Entry){this.closeEditors();this.voidForm.reset();this.voidId.set(e.id);window.scrollTo({top:0,behavior:'smooth'});}
  voidEntry(){return this.run(async()=>{
    const p=this.page();if(!p||this.voidForm.invalid)return;
    await this.api.post('/register-entries/'+this.voidId()+'/void',this.voidForm.getRawValue());
    await this.loadPage(p.book.id,p.pageNumber);this.notice.show('Upis je poništen.');
  });}
  async archive(){
    const p=this.page();
    if(!p||this.busy()||!await this.confirmation.ask(
      'Arhivirati matičnu knjigu?',
      p.book.schoolName+' · '+p.book.year+'. Nakon arhiviranja knjiga će biti dostupna za čitanje, štampu i izvoz.',
      'Arhiviraj knjigu'))return;
    return this.run(async()=>{
      await this.api.post('/register-books/'+p.book.id+'/archive');await this.loadPage(p.book.id,p.pageNumber);this.notice.show('Knjiga je arhivirana.');
    });
  }
  exportPdf(single:boolean){return this.run(async()=>{
    const p=this.page()!;
    saveBlob(await this.api.blob('/register-books/'+p.book.id+'/export/pdf'+(single?'?page='+p.pageNumber:'')),
      'maticna-knjiga-'+p.book.year+(single?'-strana-'+p.pageNumber:'')+'.pdf');
  });}
  print(){
    if(this.busy())return;
    const tab=window.open('about:blank','_blank');
    if(!tab){this.error.set('Omogućite otvaranje novog prozora za štampu.');return;}
    tab.opener=null;
    return this.run(async()=>{
      const p=this.page()!;
      try{
        const url=URL.createObjectURL(await this.api.blob('/register-books/'+p.book.id+'/export/pdf?page='+p.pageNumber));
        tab.location.replace(url);
        const timer=setInterval(()=>{if(tab.closed){clearInterval(timer);URL.revokeObjectURL(url);}},3000);
      }catch(error){tab.close();throw error;}
    });
  }
  private async run(action:()=>Promise<void>){
    if(this.busy())return;
    this.busy.set(true);this.error.set('');
    try{await action();}catch(error){this.error.set(message(error));}finally{this.busy.set(false);}
  }
}
