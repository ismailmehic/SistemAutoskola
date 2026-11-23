import {Component, effect, inject, signal} from '@angular/core';
import {RouterLink} from '@angular/router';
import {BookOpen, CircleCheck, GraduationCap, LucideAngularModule, Plus, UsersRound, Wallet} from 'lucide-angular';
import {Api, BsDate, CandidateRow, message, Money, Schools, statuses} from './core';

interface Overview {total:number;active:number;completed:number;outstanding:{currencyCode:string;total:number}[];recent:CandidateRow[]}
@Component({
  imports:[RouterLink,LucideAngularModule,BsDate,Money],
  template:`
    <div class="page-head"><div><h1>Dashboard</h1><p>Pregled kandidata i uplata za odabrane autoškole.</p></div>
      <a class="button primary" routerLink="/candidates/novi"><lucide-icon [img]="plus" size="17" />Dodaj kandidata</a></div>
    @if(error()){<p class="error" role="alert">{{error()}} <button (click)="load(schools.selected())">Pokušaj ponovo</button></p>}
    @if(data();as view){
      <div class="stat-grid">
        <article class="stat"><span class="stat-icon"><lucide-icon [img]="users" size="20"/></span><p>Ukupno kandidata</p><strong>{{view.total}}</strong></article>
        <article class="stat"><span class="stat-icon"><lucide-icon [img]="training" size="20"/></span><p>Aktivni kandidati</p><strong>{{view.active}}</strong></article>
        <article class="stat"><span class="stat-icon"><lucide-icon [img]="completed" size="20"/></span><p>Završili obuku</p><strong>{{view.completed}}</strong></article>
        <article class="stat"><span class="stat-icon"><lucide-icon [img]="wallet" size="20"/></span><p>Preostalo za uplatu</p>
          @for(item of view.outstanding;track item.currencyCode){<strong>{{item.total|money:item.currencyCode}}</strong>}@empty{<strong>{{0|money}}</strong>}
        </article>
      </div>
      <div class="actions quick"><a class="button" routerLink="/maticna-knjiga"><lucide-icon [img]="book" size="17"/>Otvori matičnu knjigu</a>
        <a class="button" routerLink="/candidates" [queryParams]="{akcija:'uplata'}"><lucide-icon [img]="wallet" size="17"/>Dodaj uplatu</a></div>
      <section class="panel">
        <div class="panel-head"><h2>Nedavno upisani kandidati</h2><a routerLink="/candidates">Svi kandidati</a></div>
        @if(view.recent.length){
          <table class="data-table responsive"><thead><tr><th>Kandidat</th><th>Autoškola</th><th>Datum upisa</th><th>Status</th></tr></thead><tbody>
          @for(row of view.recent;track row.id){<tr><td data-label="Kandidat"><a [routerLink]="['/candidates',row.id]">{{row.firstName}} {{row.lastName}}</a></td><td data-label="Autoškola">{{row.schoolName}}</td>
          <td data-label="Datum upisa">{{row.enrollmentDate|bsDate}}</td><td data-label="Status"><span class="badge" [attr.data-status]="row.status">{{labels[row.status]}}</span></td></tr>}
          </tbody></table>
        }@else{<div class="empty">Još nema upisanih kandidata za ovaj izbor.</div>}
      </section>
    }@else if(!error()){<p role="status" class="loading">Učitavanje pregleda…</p>}
  `
})
export class Dashboard {
  private api=inject(Api);readonly schools=inject(Schools);
  readonly data=signal<Overview|null>(null);readonly error=signal('');
  private request=0;
  readonly labels=statuses;readonly plus=Plus;readonly users=UsersRound;readonly completed=CircleCheck;
  readonly training=GraduationCap;readonly wallet=Wallet;readonly book=BookOpen;
  constructor(){effect(()=>void this.load(this.schools.selected()));}
  async load(schoolId:number|null){
    const request=++this.request;this.error.set('');this.data.set(null);
    try{const data=await this.api.get<Overview>('/dashboard/overview',{schoolId});if(request===this.request)this.data.set(data);}
    catch(error){if(request===this.request)this.error.set(message(error));}
  }
}
