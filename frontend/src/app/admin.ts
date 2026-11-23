import {Component, effect, inject, signal} from '@angular/core';
import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {ConfirmDialog} from './confirm-dialog';
import {Api, Auth, Instructor, message, Notice, School, Schools, Settings, statuses, Type} from './core';

@Component({
  imports:[ReactiveFormsModule,RouterLink],
  template:`
    <div class="page-head"><div><h1>Instruktori</h1><p>Upravljajte instruktorima i njihovim autoškolama.</p></div><button class="primary" (click)="edit()">Dodaj instruktora</button></div>
    @if(error()){<p class="error" role="alert">{{error()}}</p>}
    @if(editor()){
      <form class="panel inset stack" [formGroup]="form" (ngSubmit)="save()">
        <h2>{{editId()?'Uredi instruktora':'Novi instruktor'}}</h2>
        <div class="form-grid">
          <label>Ime<input formControlName="firstName" maxlength="80" required></label><label>Prezime<input formControlName="lastName" maxlength="80" required></label>
          <label>Telefon<input type="tel" formControlName="phone" maxlength="40"></label><label>E-mail<input type="email" formControlName="email" maxlength="180"></label>
          <label class="checkbox"><input type="checkbox" formControlName="isActive"> Aktivan instruktor</label>
          <label class="wide">Napomena<textarea formControlName="notes" maxlength="500" rows="2"></textarea></label>
        </div>
        <fieldset><legend>Autoškole</legend>
          @for(school of schools.items();track school.id){<label class="checkbox"><input type="checkbox" [checked]="linked().includes(school.id)" (change)="toggle(school.id,$any($event.target).checked)">
            {{school.data.name}}{{school.data.isActive?'':' (neaktivna)'}}</label>}
          @empty{<a routerLink="/postavke">Dodaj autoškolu u postavkama</a>}
        </fieldset>
        <div class="actions"><button class="primary" [disabled]="busy()||form.invalid||!linked().length">Spremi instruktora</button><button type="button" (click)="editor.set(false)" [disabled]="busy()">Otkaži</button></div>
      </form>
    }
    @if(detail();as person){
      <section class="panel inset stack"><div class="section-head"><h2>Kandidati · {{person.data.firstName}} {{person.data.lastName}}</h2><button (click)="detail.set(null)">Zatvori</button></div>
      @for(row of person.candidates??[];track row.id){
        <div class="item-row"><a [routerLink]="['/candidates',row.id]">{{row.firstName}} {{row.lastName}}</a><span class="badge" [attr.data-status]="row.status">{{labels[row.status]}}</span></div>
      }@empty{<p class="empty">Nema dodijeljenih kandidata za odabranu autoškolu.</p>}</section>
    }
    <section class="panel inset">
      @if(loading()){<p class="loading" role="status">Učitavanje instruktora…</p>}
      @for(row of rows();track row.id){
        <article class="item-row"><div><strong>{{row.data.firstName}} {{row.data.lastName}}</strong>
          <p>{{schoolNames(row.data.schoolIds)}} @if(row.data.phone){ · {{row.data.phone}}}</p></div>
          <div class="actions"><span class="badge" [attr.data-status]="row.data.isActive?'ACTIVE':'INACTIVE'">{{row.data.isActive?'Aktivan':'Neaktivan'}}</span>
            <button [disabled]="busy()" (click)="assigned(row)">Kandidati</button><button [disabled]="busy()" (click)="edit(row)">Uredi</button></div>
        </article>
      }@empty{@if(!loading()){<p class="empty">Nema instruktora za ovaj izbor.</p>}}
    </section>`
})
export class Instructors {
  private api=inject(Api);private confirmation=inject(ConfirmDialog);private notice=inject(Notice);readonly schools=inject(Schools);
  readonly labels=statuses;
  readonly rows=signal<Instructor[]>([]);readonly detail=signal<Instructor|null>(null);
  readonly error=signal('');readonly loading=signal(false);readonly busy=signal(false);readonly editor=signal(false);readonly editId=signal<number|null>(null);
  readonly linked=signal<number[]>([]);
  private request=0;
  readonly form=inject(FormBuilder).nonNullable.group({firstName:['',Validators.required],lastName:['',Validators.required],phone:'',email:['',Validators.email],notes:'',isActive:true});
  constructor(){effect(()=>{const id=this.schools.selected();this.detail.set(null);void this.load(id);});}
  private async load(schoolId:number|null){
    const request=++this.request;this.loading.set(true);this.error.set('');this.rows.set([]);
    try{const rows=await this.api.get<Instructor[]>('/instructors',{schoolId});if(request===this.request)this.rows.set(rows);}
    catch(error){if(request===this.request)this.error.set(message(error));}
    finally{if(request===this.request)this.loading.set(false);}
  }
  schoolNames(ids:number[]){return this.schools.items().filter(s=>ids.includes(s.id)).map(s=>s.data.name).join(', ');}
  edit(row?:Instructor){
    this.error.set('');this.editId.set(row?.id??null);
    this.form.reset({firstName:row?.data.firstName??'',lastName:row?.data.lastName??'',phone:row?.data.phone??'',email:row?.data.email??'',
      notes:row?.data.notes??'',isActive:row?.data.isActive??true});
    const school=this.schools.selected();this.linked.set(row?.data.schoolIds??(school?[school]:[]));this.editor.set(true);
  }
  toggle(id:number,checked:boolean){this.linked.update(ids=>checked?[...new Set([...ids,id])]:ids.filter(x=>x!==id));}
  async assigned(row:Instructor){
    this.busy.set(true);this.error.set('');
    const schoolId=this.schools.selected();
    try{const detail=await this.api.get<Instructor>('/instructors/'+row.id,{schoolId});if(schoolId===this.schools.selected())this.detail.set(detail);}
    catch(error){this.error.set(message(error));}
    finally{this.busy.set(false);}
  }
  async save(){
    if(this.busy()||this.form.invalid||!this.linked().length)return;
    const data={...this.form.getRawValue(),schoolIds:this.linked()};
    const old=this.rows().find(x=>x.id===this.editId());
    if(old?.data.isActive&&!data.isActive&&!await this.confirmation.ask('Deaktivirati instruktora?',
      'Postojeća zaduženja kandidata ostaju sačuvana.','Deaktiviraj instruktora'))return;
    this.busy.set(true);this.error.set('');
    try{
      if(this.editId())await this.api.put('/instructors/'+this.editId(),data);else await this.api.post('/instructors',data);
      this.editor.set(false);await this.load(this.schools.selected());this.notice.show('Instruktor je spremljen.');
    }catch(error){this.error.set(message(error));}
    finally{this.busy.set(false);}
  }
}

@Component({
  imports:[ReactiveFormsModule],
  template:`
    <div class="page-head"><div><h1>Postavke</h1><p>Autoškole, vlasnički račun i postavke evidencije.</p></div></div>
    @if(error()){<p class="error" role="alert">{{error()}}</p>}
    <div class="settings-grid">
      <section class="panel inset stack">
        <div class="section-head"><h2>Autoškole</h2><button class="primary" [disabled]="busy()" (click)="editSchool()">Dodaj autoškolu</button></div>
        @if(schoolOpen()){
          <form class="editor stack" [formGroup]="schoolForm" (ngSubmit)="saveSchool()">
            <h3>{{schoolId()?'Uredi autoškolu':'Nova autoškola'}}</h3>
            <div class="form-grid"><label>Naziv<input formControlName="name" maxlength="120"></label>
              <label>Grad<input formControlName="city" maxlength="100"></label><label>Adresa<input formControlName="address" maxlength="200"></label>
              <label>Telefon<input formControlName="phone" type="tel" maxlength="40"></label><label>E-mail<input formControlName="email" type="email" maxlength="180"></label>
              <label class="checkbox"><input type="checkbox" formControlName="isActive"> Aktivna autoškola</label></div>
            <div class="actions"><button class="primary" [disabled]="busy()||schoolForm.invalid">Spremi autoškolu</button><button type="button" (click)="schoolOpen.set(false)">Otkaži</button></div>
          </form>
        }
        @for(school of schools.items();track school.id){
          <div class="item-row"><div><strong>{{school.data.name}}</strong><p>{{school.data.city}} · {{school.data.isActive?'Aktivna':'Neaktivna'}}</p></div>
            <button [disabled]="busy()" (click)="editSchool(school)">Uredi</button></div>
        }@empty{<p class="empty">Dodajte prvu autoškolu za početak rada.</p>}
      </section>
      <section class="panel inset stack">
        <div class="section-head"><h2>Vrste dokumenata</h2><button [disabled]="busy()" (click)="editType()">Dodaj vrstu</button></div>
        @if(typeOpen()){
          <form class="editor stack" [formGroup]="typeForm" (ngSubmit)="saveType()">
            <label>Naziv<input formControlName="name" maxlength="100"></label>
            <label class="checkbox"><input type="checkbox" formControlName="isActive"> Aktivna vrsta</label>
            <div class="actions"><button class="primary" [disabled]="busy()||typeForm.invalid">Spremi vrstu</button><button type="button" (click)="typeOpen.set(false)">Otkaži</button></div>
          </form>
        }
        @if(loading()){<p class="loading" role="status">Učitavanje vrsta dokumenata…</p>}
        @for(type of types();track type.id){
          <div class="item-row"><div><strong>{{type.name}}</strong>@if(!type.isActive){<p>Neaktivna</p>}</div><button [disabled]="busy()" (click)="editType(type)">Uredi</button></div>
        }
      </section>
      <section class="panel inset stack">
        <h2>Vlasnički račun</h2>
        <form class="stack" [formGroup]="accountForm" (ngSubmit)="saveAccount()">
          <label>E-mail<input type="email" formControlName="email" autocomplete="username"></label>
          <label>Trenutna lozinka<input type="password" formControlName="currentPassword" autocomplete="current-password"></label>
          <label>Nova lozinka<input type="password" formControlName="newPassword" autocomplete="new-password" placeholder="Najmanje 12 znakova"></label>
          <div class="actions"><button class="primary" [disabled]="busy()||accountForm.invalid">Spremi račun</button></div>
        </form>
      </section>
      <section class="panel inset stack">
        <h2>Osnovne postavke</h2>
        <form class="stack" [formGroup]="generalForm" (ngSubmit)="saveGeneral()">
          <label>Zadani broj redova novih knjiga<input type="number" min="1" max="20" formControlName="defaultPageCapacity"></label>
          <label class="checkbox"><input type="checkbox" formControlName="enableEur"> Omogući valutu EUR</label>
          <div class="actions"><button class="primary" [disabled]="busy()||loading()||!ready()||generalForm.invalid">Spremi postavke</button></div>
        </form>
      </section>
    </div>`
})
export class SettingsPage {
  private api=inject(Api);private confirmation=inject(ConfirmDialog);private fb=inject(FormBuilder);private auth=inject(Auth);private notice=inject(Notice);readonly schools=inject(Schools);
  readonly error=signal('');readonly busy=signal(false);readonly loading=signal(true);readonly ready=signal(false);readonly types=signal<Type[]>([]);
  readonly schoolId=signal<number|null>(null);readonly schoolOpen=signal(false);readonly typeId=signal<number|null>(null);readonly typeOpen=signal(false);
  readonly schoolForm=this.fb.nonNullable.group({name:['',Validators.required],address:'',city:'',phone:'',email:['',Validators.email],isActive:true});
  readonly typeForm=this.fb.nonNullable.group({name:['',Validators.required],isActive:true});
  readonly accountForm=this.fb.nonNullable.group({email:[this.auth.email(),[Validators.required,Validators.email]],currentPassword:['',Validators.required],
    newPassword:['',Validators.minLength(12)]});
  readonly generalForm=this.fb.nonNullable.group({enableEur:false,defaultPageCapacity:[10,[Validators.required,Validators.min(1),Validators.max(20)]]});
  constructor(){void this.load();}
  private async load(){
    try{
      const [types,settings]=await Promise.all([this.api.get<Type[]>('/document-types'),this.api.get<Settings>('/settings')]);
      this.types.set(types);this.generalForm.patchValue(settings);this.ready.set(true);
    }catch(error){this.error.set(message(error));}finally{this.loading.set(false);}
  }
  private async run(action:()=>Promise<void>){
    if(this.busy())return;
    this.busy.set(true);this.error.set('');
    try{await action();}catch(error){this.error.set(message(error));}finally{this.busy.set(false);}
  }
  editSchool(row?:School){this.schoolId.set(row?.id??null);this.schoolForm.reset(row?.data??{name:'',address:'',city:'',phone:'',email:'',isActive:true});this.schoolOpen.set(true);}
  async saveSchool(){
    if(this.busy()||this.schoolForm.invalid)return;
    const data=this.schoolForm.getRawValue(), previous=this.schools.items().find(x=>x.id===this.schoolId());
    if(previous?.data.isActive&&!data.isActive&&!await this.confirmation.ask('Deaktivirati autoškolu?',
      'Evidencija autoškole ostaje dostupna.','Deaktiviraj autoškolu'))return;
    return this.run(async()=>{
      if(this.schoolId())await this.api.put('/schools/'+this.schoolId(),data);else await this.api.post('/schools',data);
      await this.schools.load();this.schoolOpen.set(false);this.notice.show('Autoškola je spremljena.');
    });
  }
  editType(row?:Type){this.typeId.set(row?.id??null);this.typeForm.reset({name:row?.name??'',isActive:row?.isActive??true});this.typeOpen.set(true);}
  saveType(){
    if(this.typeForm.invalid)return;
    return this.run(async()=>{
      if(this.typeId())await this.api.put('/document-types/'+this.typeId(),this.typeForm.getRawValue());else await this.api.post('/document-types',this.typeForm.getRawValue());
      this.types.set(await this.api.get<Type[]>('/document-types'));this.typeOpen.set(false);this.notice.show('Vrsta dokumenta je spremljena.');
    });
  }
  saveGeneral(){return this.run(async()=>{
    if(this.generalForm.invalid||!this.ready())return;
    await this.api.put('/settings',this.generalForm.getRawValue());this.notice.show('Postavke su spremljene.');
  });}
  saveAccount(){return this.run(async()=>{
    if(this.accountForm.invalid)return;
    const fields=this.accountForm.getRawValue();await this.auth.change({...fields,newPassword:fields.newPassword||null});
    this.accountForm.reset({email:this.auth.email(),currentPassword:'',newPassword:''});this.notice.show('Račun je spremljen.');
  });}
}
