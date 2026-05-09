import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/httpErrors.js';
import { exportDrilldownCsv, getDrilldown, getWorkspace } from '../modules/reports/service.js';
import { requireReadPermission } from './shared.js';

export const reportsRouter = Router();

reportsRouter.get(
  '/reports/workspace',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'dashboard.view');
    response.json(await getWorkspace());
  })
);

const drilldownQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(250).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

reportsRouter.get(
  '/reports/drilldowns/:kind',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'dashboard.view');
    response.json(
      await getDrilldown({
        kind: String(request.params.kind || ''),
        ...drilldownQuerySchema.parse(request.query),
      })
    );
  })
);

reportsRouter.get(
  '/reports/drilldowns/:kind/export.csv',
  asyncHandler(async (request, response) => {
    const actor = await requireReadPermission(request, 'dashboard.view');
    const exportResult = await exportDrilldownCsv(actor, {
      kind: String(request.params.kind || ''),
    });

    response.setHeader('cache-control', 'no-store');
    response.setHeader('content-type', 'text/csv; charset=utf-8');
    response.setHeader(
      'content-disposition',
      `attachment; filename="${exportResult.fileName}"`
    );
    response.setHeader('x-content-type-options', 'nosniff');
    response.send(exportResult.csv);
  })
);
