import {Component, effect, inject, signal} from '@angular/core';
import {FormBuilder, FormControl, ReactiveFormsModule, Validators} from '@angular/forms';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {LucideAngularModule, Plus, Search} from 'lucide-angular';
import {Api, BsDate, Candidate, CandidateData, CandidateRow, Extraction, Instructor, message, Notice, Paged, RegisterSuggestions, Schools, Settings, statuses, today, Type, uploadForm} from './core';

@Component({
  imports:[RouterLink,ReactiveFormsModule,BsDate,LucideAngularModule],
  template:`
    <div class="page-head"><div><h1>{{payment?'Odaberite kandidata za uplatu':'Kandidati'}}</h1><p>Pretražite upisane kandidate i otvorite njihov profil.</p></div>
      <a class="button primary" routerLink="/candidates/novi"><lucide-icon [img]="plus" size="17"/>Dodaj kandidata</a></div>
    <section class="panel">
      <form class="filters" [formGroup]="filters" (ngSubmit)="apply()">
        <label>Pretraga po imenu<input type="search" formControlName="search" placeholder="Ime ili prezime"></label>
        <label>Status<select formControlName="status"><option value="">Svi statusi</option>@for(key of keys;track key){<option [value]="key">{{labels[key]}}</option>}</select></label>
        <label>Instruktor<select formControlName="instructorId"><option value="">Svi instruktori</option>@for(row of instructors();track row.id){<option [value]="row.id">{{row.data.firstName}} {{row.data.lastName}}</option>}</select></label>
        <label>Godina upisa<input type="number" formControlName="year" min="1900" max="9998" placeholder="Sve godine"></label>
        <button class="secondary"><lucide-icon [img]="search" size="16"/>Pretraži</button>
      </form>
      @if(error()){<p class="error inset" role="alert">{{error()}}</p>}
      @if(data();as view){
        @if(view.items.length){
          <table class="data-table responsive"><thead><tr><th>Kandidat</th><th>Autoškola</th><th>Kategorija</th><th>Datum upisa</th><th>Status</th></tr></thead><tbody>
            @for(row of view.items;track row.id){<tr><td data-label="Kandidat"><a [routerLink]="['/candidates',row.id]" [queryParams]="payment?{tab:'uplate',akcija:'nova'}:{}">{{row.firstName}} {{row.lastName}}</a></td>
              <td data-label="Autoškola">{{row.schoolName}}</td><td data-label="Kategorija">{{row.drivingCategory}}</td><td data-label="Datum upisa">{{row.enrollmentDate|bsDate}}</td>
              <td data-label="Status"><span class="badge" [attr.data-status]="row.status">{{labels[row.status]}}</span></td></tr>}
          </tbody></table>
          <div class="pagination"><span>{{view.total}} kandidata</span><button (click)="move(-1)" [disabled]="view.page===1">Prethodna</button><span>Strana {{view.page}}</span><button (click)="move(1)" [disabled]="view.page*view.pageSize>=view.total">Sljedeća</button></div>
        }@else{<p class="empty">Nema kandidata za zadane kriterije.</p>}
      }@else if(!error()){<p class="loading inset" role="status">Učitavanje kandidata…</p>}
    </section>`
})
export class Candidates {
  private api=inject(Api);private schools=inject(Schools);private route=inject(ActivatedRoute);
  readonly filters=inject(FormBuilder).nonNullable.group({search:'',status:'ACTIVE',instructorId:'',year:new FormControl<number|null>(Number(today().slice(0,4)))});
  readonly data=signal<Paged<CandidateRow>|null>(null);readonly error=signal('');readonly instructors=signal<Instructor[]>([]);
  readonly plus=Plus;readonly search=Search;readonly labels=statuses;readonly keys=Object.keys(statuses);
  readonly payment=this.route.snapshot.queryParamMap.get('akcija')==='uplata';
  private request=0;private schoolRequest=0;
  constructor(){effect(()=>{const id=this.schools.selected();this.filters.patchValue({instructorId:''});void this.load(id,1);void this.loadInstructors(id);});}
  apply(){void this.load(this.schools.selected(),1);}
  move(delta:number){void this.load(this.schools.selected(),(this.data()?.page??1)+delta);}
  private async loadInstructors(schoolId:number|null){
    const request=++this.schoolRequest;
    try{const items=await this.api.get<Instructor[]>('/instructors',{schoolId});if(request===this.schoolRequest)this.instructors.set(items);}
    catch(error){if(request===this.schoolRequest)this.error.set(message(error));}
  }
  private async load(schoolId:number|null,page:number){
    const request=++this.request;this.data.set(null);this.error.set('');
    try{const view=await this.api.get<Paged<CandidateRow>>('/candidates',{...this.filters.getRawValue(),schoolId,page});if(request===this.request)this.data.set(view);}
    catch(error){if(request===this.request)this.error.set(message(error));}
  }
}

const emptyCandidate:CandidateData={
  drivingSchoolId:0,firstName:'',lastName:'',fatherName:'',dateOfBirth:'',municipalityOfBirth:'',jmbg:'',address:'',
  phone:'',email:'',drivingCategory:'B',enrollmentDate:today(),status:'ACTIVE',notes:'',agreedPrice:0,currencyCode:'BAM',completionDate:null
};
export const candidateFieldNames:Record<string,string>={
  firstName:'Ime',lastName:'Prezime',fatherName:'Ime oca',dateOfBirth:'Datum rođenja',municipalityOfBirth:'Općina rođenja',
  jmbg:'JMBG',address:'Adresa',medicalCertificateNumber:'Broj ljekarskog uvjerenja',medicalCertificateDate:'Datum ljekarskog uvjerenja',
  medicalInstitution:'Zdravstvena ustanova',theoryCertificateNumber:'Broj potvrde o teoriji',theoryCertificateDate:'Datum potvrde o teoriji',
  firstAidCertificateNumber:'Broj potvrde o prvoj pomoći',firstAidCertificateDate:'Datum potvrde o prvoj pomoći',
  drivingCertificateNumber:'Broj potvrde o praktičnoj obuci',drivingCertificateDate:'Datum potvrde o praktičnoj obuci'
};
@Component({
  imports:[ReactiveFormsModule,RouterLink],
  template:`
    <a class="back" [routerLink]="id?['/candidates',id]:['/candidates']">Nazad na {{id?'profil':'kandidate'}}</a>
    <div class="page-head"><div><h1>{{id?'Uredi kandidata':'Novi kandidat'}}</h1><p>{{id?'Izmijenite podatke kandidata.':'Unesite podatke ručno ili ih pregledajte nakon učitavanja dokumenata.'}}</p></div></div>
    @if(!id){
      <section class="panel inset stack">
        <div><h2>Unos iz dokumenata</h2><p class="muted">Učitajte do pet PDF, JPG ili PNG datoteka iste vrste. Za drugu vrstu ponovite odabir.</p></div>
        <div class="form-grid" [formGroup]="upload">
          <label>Vrsta dokumenta<select formControlName="type">@for(type of types();track type.id){<option [ngValue]="type.id">{{type.name}}</option>}</select></label>
          <label>Datoteke<input #file type="file" accept=".pdf,.jpg,.jpeg,.png" multiple (change)="pick(file.files)"></label>
          <label class="camera-input">Snimite dokument<input #camera type="file" accept="image/jpeg,image/png" capture="environment" (change)="pick(camera.files)"></label>
        </div>
        <div class="actions"><button type="button" (click)="extract(file,camera)" [disabled]="!files().length||working()||!upload.value.type">{{working()?'Obrada dokumenata…':'Učitaj i očitaj dokumente'}}</button></div>
        @for(row of staged();track row.document.id){
          <div class="review-row">
            <strong>{{row.document.originalFileName}}</strong>
            <span class="muted">{{extractionStatus[row.extraction.status]}}</span>
            <button type="button" class="text-button" (click)="discard(row.document.id)">Izostavi dokument</button>
            @if(fieldEntries(row).length){
              <div class="review-fields">
                @for(entry of fieldEntries(row);track entry[0]){
                  <span>{{names[entry[0]]||entry[0]}} <strong>{{entry[1].value}}</strong> <small>Provjerite</small>
                  <button type="button" class="text-button" [attr.aria-pressed]="isCandidateField(entry[0])?null:registerFields()[entry[0]]===entry[1].value"
                    (click)="accept(entry[0],entry[1].value)">{{isCandidateField(entry[0])?'Preuzmi':registerFields()[entry[0]]===entry[1].value?'Prihvaćeno za upis':'Preuzmi za upis'}}</button></span>
                }
              </div>
            }
            @if(row.extraction.missingFields.length){<details><summary>Polja bez očitanog podatka</summary>{{missing(row)}}</details>}
          </div>
        }
      </section>
    }
    @if(error()){<p class="error" role="alert">{{error()}}</p>}
    @if(loading()){<p class="loading" role="status">Učitavanje obrasca…</p>}
    @if(!loading()&&ready()){
      <form class="panel inset stack" [formGroup]="form" (ngSubmit)="save()">
        <h2>Podaci o kandidatu</h2>
        @if(!id&&!hasActiveSchools()){<p class="muted"><a routerLink="/postavke">Dodajte autoškolu u postavkama</a> prije prvog upisa.</p>}
        <div class="form-grid">
          <label>Autoškola<select formControlName="drivingSchoolId" required><option [ngValue]="0" disabled>Odaberite autoškolu</option>
            @for(school of schools.items();track school.id){@if(school.data.isActive||(id&&form.value.drivingSchoolId===school.id)){<option [ngValue]="school.id">{{school.data.name}}</option>}}</select></label>
          <label>Kategorija<input formControlName="drivingCategory" maxlength="12" required></label>
          <label>Ime<input formControlName="firstName" maxlength="80" required></label>
          <label>Prezime<input formControlName="lastName" maxlength="80" required></label>
          <label>Ime oca<input formControlName="fatherName" maxlength="80"></label>
          <label>JMBG<input formControlName="jmbg" inputmode="numeric" maxlength="13" autocomplete="off"></label>
          <label>Datum rođenja<input type="date" formControlName="dateOfBirth" required></label>
          <label>Općina rođenja<input formControlName="municipalityOfBirth" maxlength="100" required></label>
          <label>Adresa<input formControlName="address" maxlength="200"></label>
          <label>Telefon<input type="tel" formControlName="phone" maxlength="50"></label>
          <label>E-mail<input type="email" formControlName="email" maxlength="180"></label>
          <label>Datum upisa<input type="date" formControlName="enrollmentDate" required></label>
          <label>Cijena obuke<input type="number" min="0" step="0.01" formControlName="agreedPrice" required></label>
          <label>Valuta<select formControlName="currencyCode"><option value="BAM">BAM</option>@if(eur()||form.value.currencyCode==='EUR'){<option value="EUR">EUR</option>}</select></label>
          @if(id){<label>Status<select formControlName="status">@for(key of keys;track key){<option [value]="key">{{labels[key]}}</option>}</select></label>
          @if(form.value.status==='COMPLETED'){<label>Datum završetka<input type="date" formControlName="completionDate" required></label>}}
          <label class="wide">Napomena<textarea formControlName="notes" rows="3" maxlength="1000"></textarea></label>
        </div>
        @if(staged().length){<p class="muted">Pregledajte podatke prije spremanja. Broj dokumenata koji će biti povezani s kandidatom: {{staged().length}}.</p>}
        @if(bookId){<p class="muted">Nakon spremanja možete potvrditi upis u odabranu matičnu knjigu.</p>}
        <div class="actions"><button class="primary" [disabled]="form.invalid||saving()||working()">{{saving()?'Spremanje…':'Spremi kandidata'}}</button></div>
      </form>
    }
  `
})
export class CandidateEditor {
  private api=inject(Api);private router=inject(Router);private route=inject(ActivatedRoute);private notice=inject(Notice);
  private fb=inject(FormBuilder);private suggestions=inject(RegisterSuggestions);
  readonly schools=inject(Schools);
  readonly id=Number(this.route.snapshot.paramMap.get('id'))||null;
  readonly bookId=Number(this.route.snapshot.queryParamMap.get('knjiga'))||null;
  readonly schoolFromBook=Number(this.route.snapshot.queryParamMap.get('skola'))||null;
  readonly labels=statuses;readonly keys=Object.keys(statuses);readonly names=candidateFieldNames;
  readonly extractionStatus:Record<string,string>={review:'Očitani prijedlozi čekaju provjeru.',manual:'Ručno unesite podatke. Lokalni OCR nije dostupan.',unrecognized:'Očitavanje nije pronašlo označena polja. Unesite podatke ručno.',timeout:'Očitavanje je isteklo. Unesite podatke ručno.'};
  readonly form=this.fb.group({
    drivingSchoolId:[this.schoolFromBook??this.schools.selected()??0,Validators.min(1)],firstName:['',Validators.required],lastName:['',Validators.required],
    fatherName:'',dateOfBirth:['',Validators.required],municipalityOfBirth:['',Validators.required],jmbg:['',Validators.pattern(/^[0-9]{13}$/)],
    address:'',phone:'',email:['',Validators.email],drivingCategory:['B',Validators.required],enrollmentDate:[today(),Validators.required],
    status:'ACTIVE',notes:'',agreedPrice:[0,[Validators.required,Validators.min(0)]],currencyCode:'BAM',completionDate:''
  });
  readonly upload=this.fb.nonNullable.group({type:0});
  readonly types=signal<Type[]>([]);readonly files=signal<File[]>([]);readonly staged=signal<Extraction[]>([]);
  readonly registerFields=signal<Record<string,string>>({});
  readonly working=signal(false);readonly saving=signal(false);readonly loading=signal(!!this.id||!!this.bookId);readonly ready=signal(!this.id&&!this.bookId);
  readonly error=signal('');readonly eur=signal(false);
  constructor(){void this.load();}
  private async load(){
    try{
      if(this.id){
        const row=await this.api.get<Candidate>('/candidates/'+this.id);this.form.patchValue(row.data);this.form.controls.drivingSchoolId.disable();this.ready.set(true);
      }else{
        if(this.bookId){
          const book=await this.api.get<{drivingSchoolId:number}>('/register-books/'+this.bookId);
          this.form.controls.drivingSchoolId.setValue(book.drivingSchoolId);this.form.controls.drivingSchoolId.disable();this.ready.set(true);
        }
        const types=(await this.api.get<Type[]>('/document-types')).filter(x=>x.isActive);
        this.types.set(types);this.upload.controls.type.setValue(types[0]?.id??0);
      }
      this.eur.set((await this.api.get<Settings>('/settings')).enableEur);
    }catch(error){this.error.set(message(error));}
    finally{this.loading.set(false);}
  }
  hasActiveSchools(){return this.schools.items().some(school=>school.data.isActive);}
  pick(files:FileList|null){this.files.set(Array.from(files??[]));}
  fieldEntries(row:Extraction){return Object.entries(row.extraction.fields);}
  missing(row:Extraction){return row.extraction.missingFields.map(x=>this.names[x]||x).join(', ');}
  isCandidateField(key:string){return Object.hasOwn(this.form.controls,key);}
  accept(key:string,value:string){
    if(this.isCandidateField(key))this.form.patchValue({[key]:value});
    else this.registerFields.update(fields=>({...fields,[key]:value}));
  }
  discard(id:string){this.staged.update(rows=>rows.filter(row=>row.document.id!==id));}
  async extract(input:HTMLInputElement,camera:HTMLInputElement){
    if(this.working())return;
    this.error.set('');
    if(this.files().length+this.staged().length>5){this.error.set('Možete priložiti najviše pet dokumenata pri upisu.');return;}
    this.working.set(true);
    try{
      const rows=await this.api.post<Extraction[]>('/document-extraction/extract',uploadForm(this.files(),this.upload.getRawValue().type));
      this.staged.update(previous=>[...previous,...rows]);
      for(const row of rows)for(const [key,field] of this.fieldEntries(row)){
        if(this.isCandidateField(key)&&!this.form.get(key)?.value)this.accept(key,field.value);
      }
      input.value='';camera.value='';this.files.set([]);
    }catch(error){this.error.set(message(error));}
    finally{this.working.set(false);}
  }
  async save(){
    if(this.form.invalid||this.saving()||this.working())return;
    this.error.set('');this.saving.set(true);
    const body={...emptyCandidate,...this.form.getRawValue()} as CandidateData;
    body.completionDate=body.status==='COMPLETED'?body.completionDate||null:null;
    try{
      const payload={candidate:body,uploadIds:this.staged().map(row=>row.document.id)};
      const saved=this.id?await this.api.put<{id:number}>('/candidates/'+this.id,payload):await this.api.post<{id:number}>('/candidates',payload);
      if(!this.id)this.suggestions.set(saved.id,this.registerFields());
      this.notice.show('Kandidat je spremljen.');
      if(this.bookId)await this.router.navigate(['/maticna-knjiga'],{queryParams:{knjiga:this.bookId,kandidat:saved.id}});
      else await this.router.navigate(['/candidates',saved.id]);
    }catch(error){this.error.set(message(error));}
    finally{this.saving.set(false);}
  }
}
