import {HttpClient, HttpErrorResponse, HttpInterceptorFn} from '@angular/common/http';
import {inject, Injectable, signal, Pipe, PipeTransform} from '@angular/core';
import {CanActivateFn, Router} from '@angular/router';
import {catchError, firstValueFrom, from, map, switchMap, throwError} from 'rxjs';

export interface SchoolData {name:string; address:string; city:string; phone:string; email:string; isActive:boolean}
export interface School {id:number; data:SchoolData}
export interface InstructorData {firstName:string; lastName:string; phone:string; email:string; notes:string; isActive:boolean; schoolIds:number[]}
export interface Instructor {id:number; data:InstructorData; candidates?:CandidateRow[]}
export interface Assignment {instructorId:number; firstName:string; lastName:string; allocationPercentage:number; isPrimary:boolean}
export interface CandidateData {
  drivingSchoolId:number; firstName:string; lastName:string; fatherName:string; dateOfBirth:string; municipalityOfBirth:string;
  jmbg:string; address:string; phone:string; email:string; drivingCategory:string; enrollmentDate:string;
  status:string; notes:string; agreedPrice:number; currencyCode:string; completionDate:string|null;
}
export interface CandidateRow {id:number; firstName:string; lastName:string; status:string; schoolName:string; enrollmentDate:string; drivingCategory:string; phone:string}
export interface Candidate {id:number; data:CandidateData; schoolName:string; assignments:Assignment[]}
export interface Paged<T> {items:T[]; total:number; page:number; pageSize:number}
export interface Type {id:number; name:string; isActive:boolean}
export interface Settings {enableEur:boolean; defaultPageCapacity:number}
export interface Uploaded {id:string; documentTypeId:number; originalFileName:string; contentType:string; uploadedAt:string; documentDate:string|null; expirationDate:string|null; notes:string}
export interface Extraction {document:Uploaded; extraction:{status:string; fields:Record<string,{value:string; confidence:number|null; uncertain:boolean}>; missingFields:string[]}}
export interface PaymentData {amount:number; paymentDate:string; paymentMethod:string; note:string}
export interface Payment {id:number; data:PaymentData; voidedAt:string|null}
export interface Finances {agreedPrice:number; currencyCode:string; paid:number; remaining:number; items:Payment[]}

type Params = Record<string,string|number|boolean|null|undefined>;
@Injectable({providedIn:'root'})
export class Api {
  private http=inject(HttpClient);
  get<T>(path:string, params:Params={}) {
    return firstValueFrom(this.http.get<T>('/api'+path,{params:Object.fromEntries(Object.entries(params).filter(([,v])=>v!==null&&v!==undefined&&v!=='')) as Record<string,string|number|boolean>}));
  }
  post<T=void>(path:string, body:unknown={}) {return firstValueFrom(this.http.post<T>('/api'+path,body));}
  put<T=void>(path:string, body:unknown) {return firstValueFrom(this.http.put<T>('/api'+path,body));}
  patch<T=void>(path:string, body:unknown) {return firstValueFrom(this.http.patch<T>('/api'+path,body));}
  delete(path:string) {return firstValueFrom(this.http.delete('/api'+path));}
  blob(path:string) {return firstValueFrom(this.http.get('/api'+path,{responseType:'blob'}));}
}
@Injectable({providedIn:'root'})
export class RegisterSuggestions {
  private current?:{id:number;fields:Record<string,string>};
  set(id:number,fields:Record<string,string>) {this.current={id,fields:{...fields}};}
  get(id:number) {return this.current?.id===id?this.current.fields:{};}
  clear() {this.current=undefined;}
}
const csrf={'X-Requested-With':'DrivingSchool'};
@Injectable({providedIn:'root'})
export class Auth {
  private http=inject(HttpClient);
  private router=inject(Router);
  private suggestions=inject(RegisterSuggestions);
  readonly token=signal<string|null>(null);
  readonly email=signal('');
  private pending?:Promise<boolean>;
  private epoch=0;
  private store(result:{accessToken:string;email:string}) {this.token.set(result.accessToken);this.email.set(result.email);}
  async login(data:{email:string;password:string}) {
    const result=await firstValueFrom(this.http.post<{accessToken:string;email:string}>('/api/auth/login',data,{headers:csrf}));
    this.store(result);
  }
  refresh() {
    const epoch=this.epoch;
    return this.pending??=firstValueFrom(this.http.post<{accessToken:string;email:string}>('/api/auth/refresh',{}, {headers:csrf}))
      .then(result=>{if(epoch!==this.epoch)return false;this.store(result);return true;})
      .catch(()=>{if(epoch===this.epoch)this.clear();return false;}).finally(()=>this.pending=undefined);
  }
  async change(data:{email:string;currentPassword:string;newPassword:string|null}) {
    this.store(await firstValueFrom(this.http.put<{accessToken:string;email:string}>('/api/auth/account',data,{headers:csrf})));
  }
  async logout() {
    this.epoch++;
    if(this.pending) await this.pending;
    await firstValueFrom(this.http.post('/api/auth/logout',{}, {headers:csrf}));
    this.clear();
    await this.router.navigateByUrl('/prijava');
  }
  clear() {this.suggestions.clear();this.token.set(null);this.email.set('');}
}
export const authGuard:CanActivateFn=async()=>{
  const auth=inject(Auth), router=inject(Router);
  return auth.token()||await auth.refresh()?true:router.createUrlTree(['/prijava']);
};
export const authInterceptor:HttpInterceptorFn=(req,next)=>{
  if(!req.url.startsWith('/api/')||['login','refresh','logout'].some(path=>req.url==='/api/auth/'+path))return next(req);
  const auth=inject(Auth),router=inject(Router);
  const send=()=>next(req.clone({setHeaders:{Authorization:'Bearer '+auth.token()}}));
  const initial=auth.token();
  return send().pipe(catchError((err:HttpErrorResponse)=>{
    if(err.status!==401)return throwError(()=>err);
    return from(auth.token()&&auth.token()!==initial?Promise.resolve(true):auth.refresh()).pipe(switchMap(ok=>{
      if(ok)return send();
      void router.navigateByUrl('/prijava');
      return throwError(()=>err);
    }));
  }));
};

@Injectable({providedIn:'root'})
export class Schools {
  private api=inject(Api);
  readonly items=signal<School[]>([]);
  readonly selected=signal<number|null>(Number(localStorage.getItem('driving-school-filter'))||null);
  choose(id:number|null) {this.selected.set(id);localStorage.setItem('driving-school-filter',id?.toString()??'');}
  async load() {
    const items=await this.api.get<School[]>('/schools');
    this.items.set(items);
    if(this.selected()&&!items.some(x=>x.id===this.selected()))this.choose(null);
  }
}
export function message(error:unknown) {
  if(error instanceof HttpErrorResponse) {
    if(error.status===0) return 'Veza sa serverom nije dostupna.';
    return error.error?.message??(error.status===401?'Sesija je istekla. Prijavite se ponovo.':'Zahtjev nije uspio. Pokušajte ponovo.');
  }
  return error instanceof Error ? error.message : 'Došlo je do greške.';
}
@Injectable({providedIn:'root'})
export class Notice {
  readonly text=signal('');
  private timer?:ReturnType<typeof setTimeout>;
  show(value:string){this.text.set(value);clearTimeout(this.timer);this.timer=setTimeout(()=>this.text.set(''),5000);}
}

export const statuses:Record<string,string>={ACTIVE:'Aktivan',COMPLETED:'Završio obuku',INACTIVE:'Neaktivan'};
export const methods=['Gotovina','Bankovni transfer','Kartica','Ostalo'];
const calendar=new Intl.DateTimeFormat('bs-BA',{timeZone:'Europe/Sarajevo',year:'numeric',month:'2-digit',day:'2-digit'});
function calendarParts(date:Date){
  const parts=calendar.formatToParts(date);
  return {year:parts.find(x=>x.type==='year')!.value,month:parts.find(x=>x.type==='month')!.value,day:parts.find(x=>x.type==='day')!.value};
}
export function today(){
  const {year,month,day}=calendarParts(new Date());
  return [year,month,day].join('-');
}
@Pipe({name:'bsDate'})
export class BsDate implements PipeTransform {
  transform(value:string|null|undefined){
    if(!value)return '—';
    const date=value.length===10?new Date(value+'T12:00:00Z'):new Date(value);
    if(Number.isNaN(date.valueOf()))return '—';
    const {year,month,day}=calendarParts(date);
    return `${day}.${month}.${year}.`;
  }
}
@Pipe({name:'money'})
export class Money implements PipeTransform {
  transform(value:number,currency='BAM'){return new Intl.NumberFormat('bs-BA',{style:'currency',currency}).format(value);}
}
export function saveBlob(blob:Blob,name:string){
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function uploadForm(files:File[], type:number, metadata:Record<string,string>={}) {
  const form=new FormData();
  form.set('documentTypeId',String(type));
  for(const file of files)form.append('files',file);
  for(const [key,value] of Object.entries(metadata))form.set(key,value);
  return form;
}
