import { DeleteRentalPropertyButton, RentalPropertyForm } from "@/components/payroll/rental-property-panel";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { RENTAL_PROPERTY_SITUATIONS } from "@/server/fiscal/withholdings";
import { listLandlordOptions, listRentalProperties } from "@/server/payroll/service";

export default async function RentalPropertiesPage() {
  const ctx = await requireContext("accounting.read");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  const [properties, landlords] = await Promise.all([listRentalProperties(ctx.company.id), listLandlordOptions(ctx.company.id)]);
  const canWrite = can(ctx.membership.role, "accounting.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Nóminas y retenciones"
        title="Inmuebles alquilados"
        description="Locales u oficinas que alquilas con retención. El resumen anual de alquileres (modelo 180) pide la referencia catastral y la situación de cada uno."
      />
      {canWrite ? (
        <PageSection title="Añadir un inmueble" description="Enlázalo con el proveedor que te factura el alquiler.">
          {landlords.length === 0 ? (
            <EmptyState title="No hay proveedores" description="Da de alta al arrendador como proveedor y registra sus facturas con retención y gasto en la cuenta 621." />
          ) : (
            <RentalPropertyForm landlords={landlords} />
          )}
        </PageSection>
      ) : null}
      <PageSection title="Inmuebles" description="Las bases y retenciones salen de las facturas del arrendador con gasto en la cuenta 621 (arrendamientos).">
        {properties.length === 0 ? (
          <EmptyState title="Sin inmuebles" description="Si no pagas alquileres con retención, no necesitas esta pantalla ni los modelos 115 y 180." />
        ) : (
          <TableContainer>
            <Table className="min-w-[48rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Arrendador</TableHead>
                  <TableHead>NIF</TableHead>
                  <TableHead>Referencia catastral</TableHead>
                  <TableHead>Situación</TableHead>
                  <TableHead>Dirección</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {properties.map((property) => (
                  <TableRow key={property.id}>
                    <TableCell className="font-medium">{property.supplierName}</TableCell>
                    <TableCell className="font-mono">{property.supplierTaxId ?? <span className="text-warning-text">Falta</span>}</TableCell>
                    <TableCell className="font-mono">{property.cadastralReference ?? "—"}</TableCell>
                    <TableCell title={RENTAL_PROPERTY_SITUATIONS[property.situation]}>{property.situation}</TableCell>
                    <TableCell>{[property.address, property.postalCode, property.city, property.province].filter(Boolean).join(", ") || "—"}</TableCell>
                    <TableCell className="text-right">{canWrite ? <DeleteRentalPropertyButton id={property.id} /> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </PageSection>
    </PageShell>
  );
}
