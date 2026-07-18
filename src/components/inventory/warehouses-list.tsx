"use client";

import Link from "next/link";
import { DeleteButton } from "@/components/delete-button";
import { buttonVariants } from "@/components/ui/button";
import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";

export type WarehouseRow = { id: string; code: string; name: string; itemCount: number; quantity: number; canManage: boolean };
const columns: ResourceListColumn<WarehouseRow>[] = [{ header: "Almacén", cell: (row) => <Link className="font-medium underline-offset-4 hover:underline" href={`/inventory/warehouses/${row.id}`}>{row.name}<span className="block font-mono text-xs text-muted-foreground">{row.code}</span></Link>, exportValue: (row) => row.name, sortValue: (row) => row.name }, { header: "Referencias", cell: (row) => row.itemCount, exportValue: (row) => row.itemCount, sortValue: (row) => row.itemCount, className: "text-right" }, { header: "Unidades", cell: (row) => <span className="font-mono">{row.quantity.toLocaleString("es-ES", { maximumFractionDigits: 3 })}</span>, exportValue: (row) => row.quantity, sortValue: (row) => row.quantity, className: "text-right" }, { header: "Acciones", cell: (row) => <div className="flex justify-end gap-2"><Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/inventory/warehouses/${row.id}/edit`}>Editar</Link>{row.canManage ? <DeleteButton description="Sólo puede eliminarse si no tiene movimientos de stock." title={`Eliminar ${row.name}`} url={`/api/warehouses/${row.id}`} /> : null}</div>, className: "text-right" }];
export function WarehousesList({ rows }: { rows: WarehouseRow[] }) { return <ResourceList columns={columns} emptyDescription="Crea una ubicación para comenzar a registrar existencias." emptyTitle="No hay almacenes" exportFileName="almacenes.csv" getRowId={(row) => row.id} getSearchText={(row) => `${row.code} ${row.name}`} items={rows} testId="warehouses-list" title="Almacenes" />; }
