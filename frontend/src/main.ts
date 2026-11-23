import {Component} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
import {provideHttpClient, withInterceptors} from '@angular/common/http';
import {provideRouter, RouterOutlet, Routes} from '@angular/router';
import {authGuard, authInterceptor} from './app/core';
@Component({selector:'app-root',imports:[RouterOutlet],template:'<router-outlet />'})
class App {}
const routes: Routes = [
  {path:'prijava',loadComponent:()=>import('./app/shell').then(m=>m.Login)},
  {path:'',canActivate:[authGuard],loadComponent:()=>import('./app/shell').then(m=>m.Layout),children:[
    {path:'',pathMatch:'full',redirectTo:'dashboard'},
    {path:'dashboard',loadComponent:()=>import('./app/dashboard').then(m=>m.Dashboard)},
    {path:'maticna-knjiga',loadComponent:()=>import('./app/register').then(m=>m.Register)},
    {path:'candidates',loadComponent:()=>import('./app/candidates').then(m=>m.Candidates)},
    {path:'candidates/novi',loadComponent:()=>import('./app/candidates').then(m=>m.CandidateEditor)},
    {path:'candidates/:id/uredi',loadComponent:()=>import('./app/candidates').then(m=>m.CandidateEditor)},
    {path:'candidates/:id',loadComponent:()=>import('./app/profile').then(m=>m.Profile)},
    {path:'instruktori',loadComponent:()=>import('./app/admin').then(m=>m.Instructors)},
    {path:'postavke',loadComponent:()=>import('./app/admin').then(m=>m.SettingsPage)}
  ]},
  {path:'**',redirectTo:'dashboard'}
];
bootstrapApplication(App,{providers:[provideRouter(routes),provideHttpClient(withInterceptors([authInterceptor]))]});
