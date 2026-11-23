using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DrivingSchool.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CandidateDocumentFolders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DocumentFolder",
                table: "Candidates",
                type: "character varying(65)",
                maxLength: 65,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DocumentFolder",
                table: "Candidates");
        }
    }
}
