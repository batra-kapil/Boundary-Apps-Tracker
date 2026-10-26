import { LightningElement, api } from "lwc";

/**
 * Lays out the Boundary Application Network graph and the Boundary Impact Panel side by side,
 * 75% / 25%, so an admin can see the visual map and the detailed list at the same time without
 * fighting the Lightning App Page template's fixed column widths. Both child components manage
 * their own object picker and filters independently.
 */
export default class BoundaryImpactDashboard extends LightningElement {
  // Default object for both child components; each still has its own picker to switch away from it.
  @api objectApiName;

  // Optional default field, passed through to both children.
  @api fieldApiName;
}
