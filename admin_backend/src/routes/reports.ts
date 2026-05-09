import { Router } from 'express';
import { asyncHandler } from '../lib/httpErrors.js';
import { sendPrivateJsonWithEtag } from '../lib/httpCache.js';
import { exportDrilldownCsv, getDrilldown, getWorkspace } from '../modules/reports/service.js';
import { parsePaginationQuery } from './queryValidation.js';
import { requireReadPermission } from './shared.js';

export const reportsRouter = Router();

reportsRouter.get(
  '/reports/workspace',
  asyncHandler(async (request, response) => {
    const actor = await requireReadPermission(request, 'dashboard.view');
    sendPrivateJsonWithEtag(request, response, {
      actor,
      payload: await getWorkspace(),
      scope: 'admin.reports.workspace',
    });
  })
);

reportsRouter.get(
  '/reports/drilldowns/:kind',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'dashboard.view');
    response.json(
      await getDrilldown({
        kind: String(request.params.kind || ''),
        ...parsePaginationQuery(request.query, { maxLimit: 250 }),
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
