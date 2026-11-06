import { Routes } from '@angular/router';

import { CatalogComponent } from './catalog.component';
import { CollectionsComponent } from './collections.component';

export const routes: Routes = [
  { path: '', redirectTo: 'catalogo', pathMatch: 'full' },
  { path: 'catalogo', component: CatalogComponent },
  { path: 'colecciones', component: CollectionsComponent },
  { path: '**', redirectTo: 'catalogo' },
];
