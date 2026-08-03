import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      await db.rawQuery(`
        UPDATE preview_usage_samples AS sample
        JOIN (
          SELECT
            accounted.id,
            GREATEST(
              accounted.cumulative_estimated_cost_usd - COALESCE(accounted.previous_peak, 0),
              0
            ) AS corrected_estimated_cost_usd
          FROM (
            SELECT
              id,
              cumulative_estimated_cost_usd,
              MAX(cumulative_estimated_cost_usd) OVER (
                PARTITION BY session_id, generation
                ORDER BY observed_at, id
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ) AS previous_peak
            FROM preview_usage_samples
          ) AS accounted
        ) AS correction ON correction.id = sample.id
        SET sample.estimated_cost_usd = correction.corrected_estimated_cost_usd
      `)
    })
  }

  async down() {
    // Derived usage deltas cannot be restored to their previously inflated values.
  }
}
