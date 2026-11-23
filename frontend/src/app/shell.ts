import {Component, inject, signal} from '@angular/core';
import {Router, RouterLink, RouterLinkActive, RouterOutlet} from '@angular/router';
import {FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {BookOpen, Building2, CarFront, Gauge, GraduationCap, LogOut, LucideAngularModule, Settings2, UsersRound, Menu} from 'lucide-angular';
import {Auth, message, Notice, Schools} from './core';
import {ConfirmDialogComponent} from './confirm-dialog';

@Component({
  imports:[ReactiveFormsModule,LucideAngularModule],
  template:`
    <main class="login-screen">
      <section class="login-card">
        <div class="brand-icon"><lucide-icon [img]="car" size="23" /></div>
        <h1>Sistem autoškola</h1>
        <p class="muted">Prijavite se za pristup evidenciji autoškola.</p>
        <form class="stack" [formGroup]="form" (ngSubmit)="submit()">
          <label>E-mail<input type="email" formControlName="email" autocomplete="username" required></label>
          <label>Lozinka<input type="password" formControlName="password" autocomplete="current-password" required></label>
          @if(error()){<p class="error" role="alert">{{error()}}</p>}
          <button class="primary" [disabled]="form.invalid||busy()">{{busy()?'Prijava je u toku…':'Prijavi se'}}</button>
        </form>
      </section>
    </main>`
})
export class Login {
  readonly car=CarFront;
  readonly form=inject(FormBuilder).nonNullable.group({email:['',[Validators.required,Validators.email]],password:['',Validators.required]});
  private auth=inject(Auth);
  private router=inject(Router);
  readonly error=signal('');
  readonly busy=signal(false);
  async submit(){
    if(this.form.invalid||this.busy())return;
    this.busy.set(true);this.error.set('');
    try{await this.auth.login(this.form.getRawValue());await this.router.navigateByUrl('/dashboard');}
    catch(error){this.error.set(message(error));}
    finally{this.busy.set(false);}
  }
}

@Component({
  imports:[RouterOutlet,RouterLink,RouterLinkActive,LucideAngularModule,ConfirmDialogComponent],
  template:`
    <div class="app-shell">
      <aside class="sidebar" [class.open]="menuOpen()">
        <a class="brand" routerLink="/dashboard" (click)="menuOpen.set(false)">
          <span class="brand-icon"><lucide-icon [img]="car" size="20" /></span>
          <span>Sistem autoškola</span>
        </a>
        <nav aria-label="Glavna navigacija">
          @for(item of nav;track item.path){
            <a [routerLink]="item.path" routerLinkActive="active" (click)="menuOpen.set(false)"><lucide-icon [img]="item.icon" size="18" />{{item.label}}</a>
          }
        </nav>
        <button class="logout" (click)="logout()"><lucide-icon [img]="exit" size="18" /> Odjavi se</button>
      </aside>
      @if(menuOpen()){<button type="button" class="nav-scrim" aria-label="Zatvori navigaciju" (click)="menuOpen.set(false)"></button>}
      <div class="workspace">
        <header class="topbar">
          <button type="button" class="icon-button mobile-menu" aria-label="Glavna navigacija" [attr.aria-expanded]="menuOpen()" (click)="menuOpen.update(v=>!v)"><lucide-icon [img]="menu" size="22" /></button>
          <label class="school-picker"><lucide-icon [img]="building" size="18" /><span>Autoškola</span>
            <select aria-label="Autoškola" [value]="schools.selected()??''" (change)="schools.choose(+$any($event.target).value||null)">
              <option value="">Sve autoškole</option>
              @for(school of schools.items();track school.id){<option [value]="school.id" [selected]="schools.selected()===school.id">{{school.data.name}}{{school.data.isActive?'':' (neaktivna)'}}</option>}
            </select>
          </label>
          <div class="owner" [title]="auth.email()"><span class="avatar">{{auth.email().slice(0,1).toUpperCase()||'A'}}</span><span>Vlasnik</span></div>
        </header>
        <main class="content"><router-outlet /></main>
      </div>
      <app-confirm-dialog />
      @if(notice.text()){<div class="notice" role="status">{{notice.text()}}</div>}
    </div>`
})
export class Layout {
  readonly auth=inject(Auth);readonly schools=inject(Schools);readonly notice=inject(Notice);
  readonly menuOpen=signal(false);
  readonly car=CarFront;readonly exit=LogOut;readonly menu=Menu;readonly building=Building2;
  readonly nav=[
    {path:'/dashboard',label:'Dashboard',icon:Gauge},{path:'/maticna-knjiga',label:'E-Matična knjiga',icon:BookOpen},
    {path:'/candidates',label:'Kandidati',icon:UsersRound},{path:'/instruktori',label:'Instruktori',icon:GraduationCap},
    {path:'/postavke',label:'Postavke',icon:Settings2}
  ];
  constructor(){void this.schools.load().catch(error=>this.notice.show(message(error)));}
  async logout(){try{await this.auth.logout();}catch(error){this.notice.show(message(error));}}
}
